"""의도 분석 결과를 세션 생성/갱신으로 반영한다 (docs/data-model-v2.md §4~§6).

tabs JSONB 단일 작성자 원칙(§4.1) — 세션 생성 이후 tabs를 갱신하는 주체는 이 모듈
하나로 제한한다. 스냅샷 경로(_ai_update)와 Auto Session 배치 모두 record_version()을
공유해 session_versions에 이력을 남긴다.
"""

import logging
from datetime import datetime, timezone

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import ExplorationEvent, Session as SessionModel, SessionEvent, SessionVersion
from ..db.session import AsyncSessionLocal
from ..schemas.session import TabItemRequest
from .embedding_sync import embed_and_upsert
from .intent_analyzer import Assignment
from .noise_filter import is_short_stray
from .summarizer import generate_summary

logger = logging.getLogger(__name__)

_TABS_TOP_N = 20
_REFRESH_TOP_N = 10
_HOLD_FORCE_CREATE_THRESHOLD = 3
_TITLE_MAX_CHARS = 20


# ── 순수 함수(DB 없음) ──────────────────────────────────────────────


def _fallback_title(sorted_events: list[dict]) -> str:
    """LLM이 제목을 주지 않았을 때 쓰는 규칙 기반 제목(20자 캡)."""
    if not sorted_events:
        return "새 세션"
    first = sorted_events[0]
    base = (first.get("title") or first.get("domain") or "탐색 세션").strip()
    if len(sorted_events) == 1:
        return base[:_TITLE_MAX_CHARS]
    return f"{base[:15]} 외 {len(sorted_events) - 1}개"


def _hold_forces_create(hold_count: int) -> bool:
    """hold_count가 임계치 이상이면 무한 보류를 막기 위해 강제 create한다."""
    return hold_count >= _HOLD_FORCE_CREATE_THRESHOLD


def _select_representative_tabs(pairs: list[dict], limit: int = _TABS_TOP_N) -> list[dict]:
    """relevance_score 내림차순 + sequence_order 오름차순으로 대표 페이지 top-N을 고른다."""
    ordered = sorted(
        pairs,
        key=lambda p: (
            -(p["relevance_score"] if p["relevance_score"] is not None else -1.0),
            p["sequence_order"],
        ),
    )
    return [
        {
            "tab_id": p["event_id"],
            "title": p.get("title") or "",
            "url": p.get("url", ""),
            "fav_icon_url": None,
        }
        for p in ordered[:limit]
    ]


def _select_refresh_candidates(pairs: list[dict], limit: int = _REFRESH_TOP_N) -> list[dict]:
    """relevance*max(duration,1) 내림차순으로 재요약에 쓸 상위 이벤트를 고른다."""

    def score(p: dict) -> float:
        relevance = p["relevance_score"] if p["relevance_score"] is not None else 0.0
        duration = max(p.get("active_duration_ms") or 0, 1)
        return relevance * duration

    return sorted(pairs, key=score, reverse=True)[:limit]


# ── DB 게이트웨이 함수(단일 책임, 테스트에서 모킹 가능) ────────────────


async def _mark_events_status(db: AsyncSession, event_ids: list[str], status: str) -> None:
    if not event_ids:
        return
    await db.execute(
        update(ExplorationEvent).where(ExplorationEvent.id.in_(event_ids)).values(sync_status=status)
    )


async def _increment_hold_count(db: AsyncSession, event_ids: list[str]) -> dict[str, int]:
    if not event_ids:
        return {}
    result = await db.execute(
        update(ExplorationEvent)
        .where(ExplorationEvent.id.in_(event_ids))
        .values(hold_count=ExplorationEvent.hold_count + 1)
        .returning(ExplorationEvent.id, ExplorationEvent.hold_count)
    )
    return {row.id: row.hold_count for row in result.all()}


async def _next_sequence_order(db: AsyncSession, session_id: str) -> int:
    result = await db.execute(
        select(func.max(SessionEvent.sequence_order)).where(SessionEvent.session_id == session_id)
    )
    current_max = result.scalar_one_or_none()
    return 0 if current_max is None else current_max + 1


async def _insert_session_events(db: AsyncSession, session_id: str, rows: list[dict]) -> None:
    if not rows:
        return
    stmt = pg_insert(SessionEvent).values(
        [{"session_id": session_id, **row} for row in rows]
    ).on_conflict_do_nothing(index_elements=["session_id", "event_id"])
    await db.execute(stmt)


async def _count_session_events(db: AsyncSession, session_id: str) -> int:
    result = await db.execute(
        select(func.count()).select_from(SessionEvent).where(SessionEvent.session_id == session_id)
    )
    return result.scalar_one()


async def _fetch_session_event_pairs(db: AsyncSession, session_id: str) -> list[dict]:
    result = await db.execute(
        select(SessionEvent, ExplorationEvent)
        .join(ExplorationEvent, SessionEvent.event_id == ExplorationEvent.id)
        .where(SessionEvent.session_id == session_id)
    )
    pairs: list[dict] = []
    for session_event, event in result.all():
        pairs.append(
            {
                "event_id": session_event.event_id,
                "relevance_score": session_event.relevance_score,
                "sequence_order": session_event.sequence_order,
                "title": event.title,
                "url": event.url,
                "active_duration_ms": event.active_duration_ms,
                "content_excerpt": event.content_excerpt,
            }
        )
    return pairs


# ── 세션 생성/갱신 ──────────────────────────────────────────────


async def _create_session(
    db: AsyncSession,
    events: list[dict],
    title: str | None,
    purpose: str | None,
    relevance: float,
) -> str:
    sorted_events = sorted(events, key=lambda e: e["visited_at"])
    session_title = ((title or "").strip()[:_TITLE_MAX_CHARS]) or _fallback_title(sorted_events)
    total_duration = sum(e.get("active_duration_ms") or 0 for e in sorted_events)

    session = SessionModel(
        title=session_title,
        tabs=[],
        summary={
            "overview": "",
            "purpose": purpose or "",
            "highlights": [],
            "todos": [],
            "next_actions": [],
        },
        tab_count=0,
        summary_status="pending",
        embedding_status="pending",
        origin="events",
        status="active",
        started_at=sorted_events[0]["visited_at"],
        last_activity_at=sorted_events[-1]["visited_at"],
        total_active_duration_ms=total_duration,
        event_count=len(sorted_events),
        # 세션 소유자 = 이 세션을 이루는 이벤트의 소유자.
        # 배치는 한 사용자 이벤트만 다루므로(sync_pipeline._claim_pending_events) 첫 이벤트로 충분하다.
        user_id=sorted_events[0]["user_id"],
    )
    db.add(session)
    await db.flush()

    await _insert_session_events(
        db,
        session.id,
        [
            {
                "event_id": e["id"],
                "relevance_score": relevance,
                "sequence_order": i,
                "assigned_by": "llm",
            }
            for i, e in enumerate(sorted_events)
        ],
    )
    await _mark_events_status(db, [e["id"] for e in sorted_events], "processed")
    return session.id


async def _append_to_session(
    db: AsyncSession,
    session_id: str,
    events: list[dict],
    relevance: float,
) -> str:
    session = await db.get(SessionModel, session_id)
    if session is None:
        # 대상 세션이 사라진 경우(동시성/삭제) — 방어적으로 새 세션 생성
        logger.warning("append 대상 세션을 찾을 수 없음(session_id=%s) — create로 대체", session_id)
        return await _create_session(db, events, None, None, relevance)

    sorted_events = sorted(events, key=lambda e: e["visited_at"])
    next_seq = await _next_sequence_order(db, session_id)

    await _insert_session_events(
        db,
        session_id,
        [
            {
                "event_id": e["id"],
                "relevance_score": relevance,
                "sequence_order": next_seq + i,
                "assigned_by": "llm",
            }
            for i, e in enumerate(sorted_events)
        ],
    )

    total_duration = sum(e.get("active_duration_ms") or 0 for e in sorted_events)
    last_visited = sorted_events[-1]["visited_at"]
    session.last_activity_at = (
        max(session.last_activity_at, last_visited) if session.last_activity_at else last_visited
    )
    session.total_active_duration_ms = (session.total_active_duration_ms or 0) + total_duration
    session.event_count = await _count_session_events(db, session_id)

    await _mark_events_status(db, [e["id"] for e in sorted_events], "processed")
    return session_id


async def _resync_tabs(db: AsyncSession, session_id: str) -> None:
    """tabs JSONB를 session_events 기준 대표 페이지 top-20으로 재작성(단일 작성자 원칙)."""
    pairs = await _fetch_session_event_pairs(db, session_id)
    tabs = _select_representative_tabs(pairs)
    session = await db.get(SessionModel, session_id)
    if session:
        session.tabs = tabs
        session.tab_count = len(tabs)


async def apply_assignments(
    db: AsyncSession,
    group: list[dict],
    assignments: list[Assignment],
    batch_id: str,
) -> set[str]:
    """의도 분석 결과를 세션 생성/갱신/보류/폐기로 반영하고, 갱신된 session_id 집합을 반환한다."""
    touched: set[str] = set()

    for assignment in assignments:
        events = [group[i] for i in assignment.event_indices if 0 <= i < len(group)]
        if not events:
            continue

        if assignment.action == "discard":
            await _mark_events_status(db, [e["id"] for e in events], "discarded")

        elif assignment.action == "hold":
            hold_counts = await _increment_hold_count(db, [e["id"] for e in events])
            limit_reached = [e for e in events if _hold_forces_create(hold_counts.get(e["id"], 0))]
            # 상한 도달 이벤트 중 짧고 검색어 없는 스침 방문은 create 대신 discard —
            # 잡동사니 세션 승격 방지(DecisionLog 2026-08-05 노이즈 사전 필터).
            stray = [e for e in limit_reached if is_short_stray(e)]
            forced = [e for e in limit_reached if not is_short_stray(e)]
            if stray:
                await _mark_events_status(db, [e["id"] for e in stray], "discarded")
            if forced:
                session_id = await _create_session(db, forced, None, None, assignment.relevance)
                touched.add(session_id)
            # 나머지는 claim 때 'processing'이 된 상태이므로 명시적으로 'pending'으로
            # 되돌려야 다음 배치가 다시 뽑는다 (되돌리지 않으면 영구 보류 = 이벤트 유실)
            held = [e for e in events if not _hold_forces_create(hold_counts.get(e["id"], 0))]
            if held:
                await _mark_events_status(db, [e["id"] for e in held], "pending")

        elif assignment.action == "create":
            session_id = await _create_session(
                db, events, assignment.title, assignment.purpose, assignment.relevance
            )
            touched.add(session_id)

        elif assignment.action == "append":
            if assignment.target:
                session_id = await _append_to_session(db, assignment.target, events, assignment.relevance)
            else:
                # 방어적 fallback(정상 경로에서는 intent_analyzer가 target 없는 append를 만들지 않음)
                session_id = await _create_session(
                    db, events, assignment.title, assignment.purpose, assignment.relevance
                )
            touched.add(session_id)

    for session_id in touched:
        await _resync_tabs(db, session_id)

    await db.commit()
    return touched


# ── 요약 버전 기록 / 재요약 ──────────────────────────────────────────


async def record_version(
    db: AsyncSession,
    session: SessionModel,
    summary_dict: dict,
    prompt_version: str | None,
    model: str | None,
) -> None:
    """session_versions에 version=max+1로 이력을 기록한다(commit은 호출자 책임)."""
    result = await db.execute(
        select(func.max(SessionVersion.version)).where(SessionVersion.session_id == session.id)
    )
    next_version = (result.scalar_one_or_none() or 0) + 1

    db.add(
        SessionVersion(
            session_id=session.id,
            version=next_version,
            title=session.title,
            overview=summary_dict.get("overview", ""),
            purpose=summary_dict.get("purpose", ""),
            highlights=summary_dict.get("highlights", []),
            todos=summary_dict.get("todos", []),
            next_actions=summary_dict.get("next_actions", []),
            prompt_version=prompt_version,
            model=model,
        )
    )


async def refresh_session_ai(session_id: str) -> None:
    """origin='events' 세션의 session_events를 다시 모아 재요약한다(retry-summary origin 분기 대상).

    성공 시 summary/summary_status='done' + record_version + embed_and_upsert.
    실패 시 summary_status='failed'(fallback으로 가장하지 않는다 — 기존 _ai_update와 동일 의미론).
    """
    async with AsyncSessionLocal() as db:
        session = await db.get(SessionModel, session_id)
        if not session:
            return
        pairs = await _fetch_session_event_pairs(db, session_id)

    if not pairs:
        logger.warning("재요약할 session_events가 없음 (session_id=%s)", session_id)
        async with AsyncSessionLocal() as db:
            session = await db.get(SessionModel, session_id)
            if session:
                session.summary_status = "failed"
                await db.commit()
        return

    top = _select_refresh_candidates(pairs)
    tabs = [
        TabItemRequest(
            title=p.get("title") or "",
            url=p.get("url", ""),
            text_content=p.get("content_excerpt") or "",
            tab_id=p["event_id"],
        )
        for p in top
    ]

    try:
        title, summary = await generate_summary(tabs)
    except Exception as exc:
        logger.warning("이벤트 기반 세션 재요약 실패 (session_id=%s): %s", session_id, exc)
        async with AsyncSessionLocal() as db:
            session = await db.get(SessionModel, session_id)
            if session:
                session.summary_status = "failed"
                await db.commit()
        return

    async with AsyncSessionLocal() as db:
        session = await db.get(SessionModel, session_id)
        if not session:
            return
        session.title = title
        session.summary = summary.model_dump()
        session.summary_status = "done"
        session.updated_at = datetime.now(timezone.utc)
        # summarizer.generate_summary는 model 메타를 반환하지 않아 prompt_version/model은 None.
        await record_version(db, session, summary.model_dump(), None, None)
        await db.commit()

    await embed_and_upsert(session_id, title, summary)
