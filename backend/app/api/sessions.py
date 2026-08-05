import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..ai.clusterer import cluster_tabs
from ..db.models import (
    ExplorationEvent,
    Session as SessionModel,
    SessionEvent,
    SessionVersion,
    SyncBatch,
)
from ..db.session import AsyncSessionLocal, get_db
from ..db.vector import delete_point
from ..schemas.session import (
    PatchSessionRequest,
    SaveSessionRequest,
    SessionDetail,
    SessionEventItem,
    SessionSummary,
    SessionVersionItem,
    TabItemRequest,
    TabItemResponse,
)
from ..services.embedding_sync import build_embedding_text as _build_embedding_text
from ..services.embedding_sync import embed_and_upsert as _embed_and_upsert
from ..services.session_updater import record_version, refresh_session_ai
from ..services.summarizer import generate_summary, rule_based_title

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sessions", tags=["sessions"])
_recovery_tasks: set[asyncio.Task[None]] = set()


def _finish_recovery_task(task: asyncio.Task[None]) -> None:
    _recovery_tasks.discard(task)
    if task.cancelled():
        return
    if exc := task.exception():
        logger.error("기동 복구 작업 실패: %s", exc)


def _to_detail(session: SessionModel) -> SessionDetail:
    tabs = [
        TabItemResponse(
            id=t.get("tab_id", ""),
            title=t.get("title", ""),
            url=t.get("url", ""),
            fav_icon_url=t.get("fav_icon_url"),
        )
        for t in (session.tabs or [])
    ]
    summary_data = session.summary or {}
    summary = SessionSummary(
        overview=summary_data.get("overview", ""),
        purpose=summary_data.get("purpose", ""),
        highlights=summary_data.get("highlights", []),
        todos=summary_data.get("todos", []),
        next_actions=summary_data.get("next_actions", []),
    )
    return SessionDetail(
        session_id=session.id,
        title=session.title,
        summary=summary,
        summary_status=session.summary_status,  # type: ignore[arg-type]
        tabs=tabs,
        created_at=session.created_at.isoformat(),
        updated_at=session.updated_at.isoformat(),
        last_activity_at=(
            session.last_activity_at.isoformat() if session.last_activity_at else None
        ),
    )


async def _ai_update(session_id: str, tabs_raw: list[dict]) -> None:
    """AI 요약 + Qdrant 임베딩을 백그라운드에서 처리. 두 단계의 실패를 각각 별도 상태로 기록한다."""
    try:
        tabs = [TabItemRequest(**t) for t in tabs_raw]
        title, summary = await generate_summary(tabs)

        async with AsyncSessionLocal() as db:
            session = await db.get(SessionModel, session_id)
            if not session:
                return
            session.title = title
            session.summary = summary.model_dump()
            session.summary_status = "done"
            session.updated_at = datetime.now(timezone.utc)
            # 스냅샷 경로도 성공 시 버전 기록(docs/data-model-v2.md §6) — summarizer.py는
            # model 메타를 반환하지 않아 prompt_version/model은 None으로 남긴다.
            await record_version(db, session, summary.model_dump(), None, None)
            await db.commit()
        logger.info("AI 요약 완료 (session_id=%s): %s", session_id, title)
    except Exception as exc:
        logger.warning("AI 백그라운드 요약 실패 (session_id=%s): %s", session_id, exc)
        async with AsyncSessionLocal() as db:
            session = await db.get(SessionModel, session_id)
            if session:
                session.summary_status = "failed"
                await db.commit()
        return

    await _embed_and_upsert(session_id, title, summary)


@router.post("", response_model=SessionDetail, status_code=201)
async def create_session(
    body: SaveSessionRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> SessionDetail:
    # 규칙 기반 타이틀/요약으로 즉시 저장 → 클라이언트에 빠르게 응답
    title = rule_based_title(body.tabs)
    summary = SessionSummary(
        overview=f"{len(body.tabs)}개 탭 세션",
        highlights=[t.title for t in body.tabs[:3]],
    )

    session = SessionModel(
        title=title,
        tabs=[t.model_dump() for t in body.tabs],
        summary=summary.model_dump(),
        tab_count=len(body.tabs),
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    # AI 요약 + Qdrant는 응답 후 백그라운드에서 처리
    background_tasks.add_task(_ai_update, session.id, [t.model_dump() for t in body.tabs])

    return _to_detail(session)


@router.post("/cluster", response_model=list[SessionDetail], status_code=201)
async def create_sessions_clustered(
    body: SaveSessionRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> list[SessionDetail]:
    """탭을 주제별로 클러스터링 후 세션 N개 생성. 클러스터링 실패 시 단일 세션 fallback."""
    groups = await cluster_tabs(body.tabs)

    session_groups: list[tuple[SessionModel, list[TabItemRequest]]] = []
    for group in groups:
        title = rule_based_title(group)
        summary = SessionSummary(
            overview=f"{len(group)}개 탭 세션",
            highlights=[t.title for t in group[:3]],
        )
        session = SessionModel(
            title=title,
            tabs=[t.model_dump() for t in group],
            summary=summary.model_dump(),
            tab_count=len(group),
        )
        db.add(session)
        session_groups.append((session, group))

    await db.commit()

    results: list[SessionDetail] = []
    for session, group in session_groups:
        await db.refresh(session)
        results.append(_to_detail(session))
        background_tasks.add_task(_ai_update, session.id, [t.model_dump() for t in group])

    return results


@router.get("", response_model=list[SessionDetail])
async def list_sessions(
    db: AsyncSession = Depends(get_db),
) -> list[SessionDetail]:
    # append로 탭이 추가된 세션이 위로 올라오도록 마지막 활동 기준 정렬
    # (last_activity_at이 없는 snapshot 세션은 created_at fallback)
    result = await db.execute(
        select(SessionModel).order_by(
            func.coalesce(SessionModel.last_activity_at, SessionModel.created_at).desc()
        )
    )
    return [_to_detail(s) for s in result.scalars().all()]


@router.get("/{session_id}", response_model=SessionDetail)
async def get_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
) -> SessionDetail:
    session = await db.get(SessionModel, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    return _to_detail(session)


@router.get("/{session_id}/events", response_model=list[SessionEventItem])
async def get_session_events(
    session_id: str,
    db: AsyncSession = Depends(get_db),
) -> list[SessionEventItem]:
    """Session Timeline (docs/api-design-v2.md §6) — sequence_order 순.

    세션이 없으면 404. origin='snapshot' 세션(session_events 연결 없음)은 빈 배열.
    """
    session = await db.get(SessionModel, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    result = await db.execute(
        select(SessionEvent, ExplorationEvent)
        .join(ExplorationEvent, SessionEvent.event_id == ExplorationEvent.id)
        .where(SessionEvent.session_id == session_id)
        .order_by(SessionEvent.sequence_order)
    )
    return [
        SessionEventItem(
            event_id=event.id,
            url=event.url,
            title=event.title,
            domain=event.domain,
            visited_at=event.visited_at.isoformat(),
            active_duration_ms=event.active_duration_ms,
            relevance_score=session_event.relevance_score,
            sequence_order=session_event.sequence_order,
        )
        for session_event, event in result.all()
    ]


@router.get("/{session_id}/versions", response_model=list[SessionVersionItem])
async def get_session_versions(
    session_id: str,
    db: AsyncSession = Depends(get_db),
) -> list[SessionVersionItem]:
    """요약 이력 (docs/api-design-v2.md §7) — version 내림차순. 세션 없으면 404."""
    session = await db.get(SessionModel, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    result = await db.execute(
        select(SessionVersion)
        .where(SessionVersion.session_id == session_id)
        .order_by(SessionVersion.version.desc())
    )
    return [
        SessionVersionItem(
            version=v.version,
            title=v.title,
            overview=v.overview,
            purpose=v.purpose,
            highlights=v.highlights,
            todos=v.todos,
            next_actions=v.next_actions,
            model=v.model,
            created_at=v.created_at.isoformat(),
        )
        for v in result.scalars().all()
    ]


@router.patch("/{session_id}", response_model=SessionDetail)
async def patch_session(
    session_id: str,
    body: PatchSessionRequest,
    db: AsyncSession = Depends(get_db),
) -> SessionDetail:
    session = await db.get(SessionModel, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")

    session.title = body.title
    session.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(session)
    return _to_detail(session)


@router.delete("/{session_id}", status_code=204)
async def delete_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
) -> None:
    session = await db.get(SessionModel, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    # FK에 ON DELETE가 없어 자식 행을 먼저 지워야 한다(session_events는 origin='events',
    # session_versions는 요약이 한 번이라도 성공한 모든 세션에 존재)
    await db.execute(delete(SessionEvent).where(SessionEvent.session_id == session_id))
    await db.execute(delete(SessionVersion).where(SessionVersion.session_id == session_id))
    await db.delete(session)
    await db.commit()
    await delete_point(session_id)  # Qdrant에서도 제거


@router.post("/{session_id}/retry-summary", response_model=SessionDetail)
async def retry_summary(
    session_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> SessionDetail:
    """AI 요약 실패 세션을 다시 시도 (A1 — 실패 상태 UI의 재시도 버튼용).

    origin='events'(Auto Session 배치 생성) 세션은 session_events를 다시 모아
    재요약하는 refresh_session_ai를, 그 외(origin='snapshot')는 기존 _ai_update를 쓴다
    (docs/api-design-v2.md §11 retry-summary origin 분기).
    """
    session = await db.get(SessionModel, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")

    session.summary_status = "pending"
    await db.commit()
    await db.refresh(session)

    if session.origin == "events":
        background_tasks.add_task(refresh_session_ai, session.id)
    else:
        background_tasks.add_task(_ai_update, session.id, session.tabs or [])
    return _to_detail(session)


async def _run_pending_recovery(
    pending_summary: list[SessionModel],
    pending_embed: list[SessionModel],
    pending_events_sessions: list[SessionModel] | None = None,
) -> None:
    """외부 API 제한을 넘지 않도록 기동 복구 작업을 순차 실행한다."""
    for session in pending_summary:
        logger.info("기동 시 요약 미완료 세션 재처리 (session_id=%s)", session.id)
        await _ai_update(session.id, session.tabs or [])

    for session in pending_embed:
        logger.info("기동 시 임베딩 미완료 세션 재처리 (session_id=%s)", session.id)
        summary = SessionSummary(**(session.summary or {}))
        await _embed_and_upsert(session.id, session.title, summary)

    for session in (pending_events_sessions or []):
        logger.info("기동 시 이벤트 기반 세션 재요약 (session_id=%s)", session.id)
        await refresh_session_ai(session.id)


async def _recover_sync_pipeline_state() -> None:
    """서버 재시작 시 중단된 배치/이벤트를 안전 상태로 복구한다(docs/target-architecture.md §5).

    running이던 배치는 failed로, processing이던 이벤트는 pending으로 되돌려
    다음 배치가 자동으로 재시도하게 한다.
    """
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(SyncBatch)
            .where(SyncBatch.status == "running")
            .values(
                status="failed",
                error_message="server restart",
                completed_at=datetime.now(timezone.utc),
            )
        )
        await db.execute(
            update(ExplorationEvent)
            .where(ExplorationEvent.sync_status == "processing")
            .values(sync_status="pending")
        )
        await db.commit()


async def recover_pending_sessions() -> None:
    """서버 기동 시 유실된 작업을 단일 background task로 복구한다."""
    await _recover_sync_pipeline_state()

    async with AsyncSessionLocal() as db:
        pending_summary = (
            await db.execute(
                select(SessionModel).where(
                    SessionModel.summary_status == "pending",
                    SessionModel.origin == "snapshot",
                )
            )
        ).scalars().all()
        pending_embed = (
            await db.execute(
                select(SessionModel).where(
                    SessionModel.summary_status == "done",
                    SessionModel.embedding_status.in_(["pending", "failed"]),
                )
            )
        ).scalars().all()
        pending_events_sessions = (
            await db.execute(
                select(SessionModel).where(
                    SessionModel.origin == "events",
                    SessionModel.summary_status.in_(["pending", "failed"]),
                )
            )
        ).scalars().all()

    if not pending_summary and not pending_embed and not pending_events_sessions:
        return

    task = asyncio.create_task(
        _run_pending_recovery(pending_summary, pending_embed, pending_events_sessions)
    )
    _recovery_tasks.add(task)
    task.add_done_callback(_finish_recovery_task)
