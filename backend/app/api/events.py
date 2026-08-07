import asyncio
import logging
from datetime import date as date_cls, datetime, time, timedelta, timezone
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db.models import ExplorationEvent, Session as SessionModel, SessionEvent, SyncBatch
from ..db.session import get_db
from ..schemas.event import (
    EventBatchRequest,
    EventIngestResult,
    EventListItem,
    ExplorationEventIn,
    PendingCountResponse,
)
from ..services import sync_pipeline
from ..services.event_filter import (
    content_hash,
    extract_search_query,
    is_sensitive_url,
    is_system_url,
    normalize_url,
)
from ..services.session_updater import _resync_tabs
from .deps import current_user_id

logger = logging.getLogger(__name__)
router = APIRouter(tags=["events"])

_MAX_EXCERPT_LEN = 5000
_MAX_TITLE_LEN = 500
_EVENTS_LIST_CAP = 500

_trigger_tasks: set[asyncio.Task] = set()


def _trigger_batch_if_over_threshold(pending_total: int) -> None:
    """pending ≥ sync_event_threshold면 배치를 트리거한다. 락 사용 중이면 조용히 스킵한다."""
    if pending_total < settings.sync_event_threshold or sync_pipeline.is_running():
        return

    async def _run() -> None:
        try:
            await sync_pipeline.run_batch("event_count")
        except sync_pipeline.SyncBatchRunningError:
            pass
        except Exception as exc:
            logger.warning("개수 기준 배치 트리거 실패: %s", exc)

    task = asyncio.create_task(_run())
    _trigger_tasks.add(task)
    task.add_done_callback(_trigger_tasks.discard)


def _build_event_rows(
    events: list[ExplorationEventIn], batch_device_id: str | None, user_id: str
) -> tuple[list[dict], int]:
    """이벤트별 필터/정규화를 수행해 DB insert용 row 목록과 filtered 개수를 반환한다.

    시스템 URL은 아예 저장하지 않고(filtered 카운트만 증가), 민감 도메인/경로는
    이벤트 자체는 저장하되 content_excerpt만 비운다.
    """
    rows: list[dict] = []
    filtered = 0

    for event in events:
        if is_system_url(event.url):
            filtered += 1
            continue

        excerpt = event.content_excerpt or ""
        if is_sensitive_url(event.url):
            excerpt = ""
        excerpt = excerpt[:_MAX_EXCERPT_LEN]

        title = (event.title or "")[:_MAX_TITLE_LEN] or None

        rows.append(
            {
                "id": event.id,
                "user_id": user_id,
                "device_id": event.device_id or batch_device_id,
                "source": event.source,
                "url": event.url,
                "normalized_url": normalize_url(event.url),
                "title": title,
                "domain": urlsplit(event.url).hostname,
                "search_query": extract_search_query(event.url),
                "visited_at": event.visited_at,
                "ended_at": event.ended_at,
                "active_duration_ms": event.active_duration_ms,
                "tab_id": event.tab_id,
                "window_id": event.window_id,
                "previous_event_id": event.previous_event_id,
                "referrer_url": event.referrer_url,
                "event_type": event.event_type,
                "content_excerpt": excerpt,
                "content_hash": content_hash(excerpt),
            }
        )

    return rows, filtered


async def _count_pending(db: AsyncSession, user_id: str) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(ExplorationEvent)
        .where(
            ExplorationEvent.sync_status == "pending",
            ExplorationEvent.user_id == user_id,
        )
    )
    return result.scalar_one()


@router.post("/events", response_model=EventIngestResult, status_code=202)
async def ingest_events(
    body: EventBatchRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> EventIngestResult:
    rows, filtered = _build_event_rows(body.events, body.device_id, user_id)

    accepted = 0
    duplicates = 0
    if rows:
        stmt = pg_insert(ExplorationEvent).values(rows).on_conflict_do_nothing(
            index_elements=["id"]
        )
        result = await db.execute(stmt)
        await db.commit()
        accepted = result.rowcount or 0
        duplicates = len(rows) - accepted

    pending_total = await _count_pending(db, user_id)
    _trigger_batch_if_over_threshold(pending_total)

    return EventIngestResult(
        accepted=accepted,
        duplicates=duplicates,
        filtered=filtered,
        pending_total=pending_total,
    )


@router.get("/events/pending-count", response_model=PendingCountResponse)
async def get_pending_count(
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> PendingCountResponse:
    pending = await _count_pending(db, user_id)

    result = await db.execute(
        select(SyncBatch.completed_at)
        .where(SyncBatch.status == "completed", SyncBatch.user_id == user_id)
        .order_by(SyncBatch.completed_at.desc())
        .limit(1)
    )
    last_completed = result.scalar_one_or_none()

    return PendingCountResponse(
        pending=pending,
        last_completed_sync_at=last_completed.isoformat() if last_completed else None,
    )


# ── GET /events?date= (Timeline 홈 화면, docs/api-design-v2.md §3) ──────────


def _resolve_date_range(date_param: str, *, now: datetime | None = None) -> tuple[datetime, datetime]:
    """'today' 또는 'YYYY-MM-DD'를 [start, end) 자정 범위로 변환한다(순수 함수).

    visited_at 컬럼에 저장된 값 그대로(별도 사용자 타임존 없음)의 날짜를 단순 매칭한다
    — 사용자별 타임존을 저장/변환하는 기능이 없어 UTC 자정 기준 범위로 비교한다.
    """
    if date_param == "today":
        target = (now or datetime.now(timezone.utc)).date()
    else:
        try:
            target = date_cls.fromisoformat(date_param)
        except ValueError as exc:
            raise ValueError("Invalid date parameter. Use YYYY-MM-DD or 'today'.") from exc

    start = datetime.combine(target, time.min, tzinfo=timezone.utc)
    return start, start + timedelta(days=1)


async def _fetch_events_for_date(
    db: AsyncSession, start: datetime, end: datetime, user_id: str
) -> list[EventListItem]:
    # discarded 이벤트도 반환한다 — 세션에서 제외됐을 뿐 탐색 기록으로는 유효하므로
    # Timeline에 "제외됨" 뱃지로 노출된다(사용자 결정 2026-08-05).
    result = await db.execute(
        select(ExplorationEvent, SessionEvent.session_id, SessionModel.title)
        .outerjoin(SessionEvent, SessionEvent.event_id == ExplorationEvent.id)
        .outerjoin(SessionModel, SessionEvent.session_id == SessionModel.id)
        .where(
            ExplorationEvent.user_id == user_id,
            ExplorationEvent.visited_at >= start,
            ExplorationEvent.visited_at < end,
        )
        .order_by(ExplorationEvent.visited_at.desc())
        .limit(_EVENTS_LIST_CAP)
    )

    seen: set[str] = set()
    items: list[EventListItem] = []
    for event, session_id, session_title in result.all():
        if event.id in seen:
            continue
        seen.add(event.id)
        items.append(
            EventListItem(
                event_id=event.id,
                url=event.url,
                title=event.title,
                domain=event.domain,
                visited_at=event.visited_at.isoformat(),
                active_duration_ms=event.active_duration_ms,
                session_id=session_id,
                session_title=session_title,
                excluded=event.sync_status == "discarded",
            )
        )
    return items


@router.get("/events", response_model=list[EventListItem])
async def list_events(
    date: str = Query(..., description="YYYY-MM-DD or 'today'"),
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> list[EventListItem]:
    try:
        start, end = _resolve_date_range(date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return await _fetch_events_for_date(db, start, end, user_id)


# ── DELETE /events/{id} (docs/api-design-v2.md §10) ──────────────────────


async def _recompute_session_after_event_removed(db: AsyncSession, session_id: str) -> None:
    """이벤트 삭제 후 event_count/total_active_duration_ms 재계산 + tabs 재작성.

    AI 재요약(refresh_session_ai)은 호출하지 않는다 — 즉시 재요약은 MVP 범위 밖이고
    (docs/api-design-v2.md §10), 여기서 하는 일은 순수 집계/규칙 기반 tabs 선정뿐이다.
    tabs 재작성은 session_updater의 기존 함수를 그대로 재사용한다(단일 작성자 원칙 유지).
    """
    session = await db.get(SessionModel, session_id)
    if not session:
        return

    count_result = await db.execute(
        select(func.count()).select_from(SessionEvent).where(SessionEvent.session_id == session_id)
    )
    session.event_count = count_result.scalar_one()

    duration_result = await db.execute(
        select(func.coalesce(func.sum(ExplorationEvent.active_duration_ms), 0))
        .select_from(SessionEvent)
        .join(ExplorationEvent, SessionEvent.event_id == ExplorationEvent.id)
        .where(SessionEvent.session_id == session_id)
    )
    session.total_active_duration_ms = duration_result.scalar_one()

    await _resync_tabs(db, session_id)


@router.delete("/events/{event_id}", status_code=204)
async def delete_event(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> None:
    event = await db.get(ExplorationEvent, event_id)
    # 남의 이벤트는 존재 자체를 알리지 않는다 — 403 대신 404.
    if not event or event.user_id != user_id:
        raise HTTPException(status_code=404, detail="Event not found")

    affected_result = await db.execute(
        select(SessionEvent.session_id).where(SessionEvent.event_id == event_id)
    )
    affected_session_ids = set(affected_result.scalars().all())

    await db.execute(delete(SessionEvent).where(SessionEvent.event_id == event_id))
    await db.delete(event)

    for session_id in affected_session_ids:
        await _recompute_session_after_event_removed(db, session_id)

    await db.commit()
