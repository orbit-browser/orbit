import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..ai.clusterer import cluster_tabs
from ..ai.embedding import embed
from ..config import settings
from ..db.models import Session as SessionModel
from ..db.session import AsyncSessionLocal, get_db
from ..db.vector import delete_point, upsert_point
from ..schemas.session import (
    PatchSessionRequest,
    SaveSessionRequest,
    SessionDetail,
    SessionSummary,
    TabItemRequest,
    TabItemResponse,
)
from ..services.summarizer import generate_summary, rule_based_title

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sessions", tags=["sessions"])


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
    )


async def _embed_and_upsert(session_id: str, title: str, summary: SessionSummary) -> None:
    """요약 텍스트를 embedding-passage로 임베딩해 Qdrant에 반영. 요약 성공 여부와 독립적으로 상태를 추적."""
    try:
        embed_text = f"{summary.overview} {summary.purpose} {' '.join(summary.highlights)}"
        vector = await embed(embed_text, model=settings.embedding_passage_model)
        await upsert_point(session_id, vector, {
            "session_id": session_id,
            "title": title,
            "overview": summary.overview,
            "purpose": summary.purpose,
        })
        async with AsyncSessionLocal() as db:
            session = await db.get(SessionModel, session_id)
            if session:
                session.embedding_status = "done"
                await db.commit()
    except Exception as exc:
        logger.warning("임베딩/Qdrant upsert 실패 (session_id=%s): %s", session_id, exc)
        async with AsyncSessionLocal() as db:
            session = await db.get(SessionModel, session_id)
            if session:
                session.embedding_status = "failed"
                await db.commit()


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
    result = await db.execute(
        select(SessionModel).order_by(SessionModel.created_at.desc())
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
    await db.delete(session)
    await db.commit()
    await delete_point(session_id)  # Qdrant에서도 제거


@router.post("/{session_id}/retry-summary", response_model=SessionDetail)
async def retry_summary(
    session_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> SessionDetail:
    """AI 요약 실패 세션을 다시 시도 (A1 — 실패 상태 UI의 재시도 버튼용)."""
    session = await db.get(SessionModel, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")

    session.summary_status = "pending"
    await db.commit()
    await db.refresh(session)

    background_tasks.add_task(_ai_update, session.id, session.tabs or [])
    return _to_detail(session)


async def recover_pending_sessions() -> None:
    """서버 기동 시 재시작으로 유실된 백그라운드 작업(BackgroundTasks는 프로세스 종료 시 소멸)을 복구."""
    async with AsyncSessionLocal() as db:
        pending_summary = (
            await db.execute(
                select(SessionModel).where(SessionModel.summary_status == "pending")
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

    for session in pending_summary:
        logger.info("기동 시 요약 미완료 세션 재처리 (session_id=%s)", session.id)
        asyncio.create_task(_ai_update(session.id, session.tabs or []))

    for session in pending_embed:
        logger.info("기동 시 임베딩 미완료 세션 재처리 (session_id=%s)", session.id)
        summary = SessionSummary(**(session.summary or {}))
        asyncio.create_task(_embed_and_upsert(session.id, session.title, summary))
