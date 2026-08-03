from urllib.parse import urlsplit

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import ExplorationEvent, SyncBatch
from ..db.session import get_db
from ..schemas.event import (
    EventBatchRequest,
    EventIngestResult,
    ExplorationEventIn,
    PendingCountResponse,
)
from ..services.event_filter import (
    content_hash,
    extract_search_query,
    is_sensitive_url,
    is_system_url,
    normalize_url,
)

router = APIRouter(tags=["events"])

_MAX_EXCERPT_LEN = 5000
_MAX_TITLE_LEN = 500


def _build_event_rows(
    events: list[ExplorationEventIn], batch_device_id: str | None
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
                "user_id": "local",
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


async def _count_pending(db: AsyncSession) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(ExplorationEvent)
        .where(
            ExplorationEvent.sync_status == "pending",
            ExplorationEvent.user_id == "local",
        )
    )
    return result.scalar_one()


@router.post("/events", response_model=EventIngestResult, status_code=202)
async def ingest_events(
    body: EventBatchRequest,
    db: AsyncSession = Depends(get_db),
) -> EventIngestResult:
    rows, filtered = _build_event_rows(body.events, body.device_id)

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

    pending_total = await _count_pending(db)

    return EventIngestResult(
        accepted=accepted,
        duplicates=duplicates,
        filtered=filtered,
        pending_total=pending_total,
    )


@router.get("/events/pending-count", response_model=PendingCountResponse)
async def get_pending_count(db: AsyncSession = Depends(get_db)) -> PendingCountResponse:
    pending = await _count_pending(db)

    result = await db.execute(
        select(SyncBatch.completed_at)
        .where(SyncBatch.status == "completed", SyncBatch.user_id == "local")
        .order_by(SyncBatch.completed_at.desc())
        .limit(1)
    )
    last_completed = result.scalar_one_or_none()

    return PendingCountResponse(
        pending=pending,
        last_completed_sync_at=last_completed.isoformat() if last_completed else None,
    )
