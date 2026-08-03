"""GET /analytics/overview — 집계 전용, AI 호출 없음 (docs/api-design-v2.md §9).

top_domains/repeat_visits/repeat_search_queries/daily_trend은 exploration_events
기준(discarded 제외, visited_at이 기간 내)이고, top_sessions_by_duration은 sessions
테이블 기준(origin 무관, last_activity_at 또는 created_at이 기간 내)이다 — 호출자 지시.
repeat_visits/repeat_search_queries의 최소 반복 횟수(2회+)는 api-design-v2.md §9
("계획서 D-2 그대로 따른다")를 근거로 둘 다에 적용한다.
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import ExplorationEvent, Session as SessionModel
from ..db.session import get_db
from ..schemas.analytics import (
    AnalyticsOverviewResponse,
    DailyTrendItem,
    RepeatSearchQueryItem,
    RepeatVisitItem,
    TopDomainItem,
    TopSessionItem,
)

router = APIRouter(tags=["analytics"])

_TOP_N = 5
_MIN_REPEAT_COUNT = 2


def _period_start(days: int, *, now: datetime | None = None) -> datetime:
    """[now - days, now] 구간의 시작 시각(순수 함수)."""
    return (now or datetime.now(timezone.utc)) - timedelta(days=days)


async def _fetch_top_sessions(db: AsyncSession, start: datetime) -> list[TopSessionItem]:
    """세션별 탐색 시간 top5 (origin 무관, last_activity_at 또는 created_at이 기간 내)."""
    result = await db.execute(
        select(SessionModel)
        .where(or_(SessionModel.last_activity_at >= start, SessionModel.created_at >= start))
        .order_by(SessionModel.total_active_duration_ms.desc())
        .limit(_TOP_N)
    )
    return [
        TopSessionItem(
            session_id=s.id,
            title=s.title,
            total_active_duration_ms=s.total_active_duration_ms,
            event_count=s.event_count,
        )
        for s in result.scalars().all()
    ]


async def _fetch_top_domains(db: AsyncSession, start: datetime) -> list[TopDomainItem]:
    """도메인별 방문 횟수 top5 (exploration_events, discarded 제외, visited_at 기간 내)."""
    result = await db.execute(
        select(
            ExplorationEvent.domain,
            func.count().label("visit_count"),
            func.coalesce(func.sum(ExplorationEvent.active_duration_ms), 0).label("duration_sum"),
        )
        .where(
            ExplorationEvent.sync_status != "discarded",
            ExplorationEvent.visited_at >= start,
            ExplorationEvent.domain.is_not(None),
        )
        .group_by(ExplorationEvent.domain)
        .order_by(func.count().desc())
        .limit(_TOP_N)
    )
    return [
        TopDomainItem(domain=domain, visit_count=visit_count, total_active_duration_ms=duration_sum)
        for domain, visit_count, duration_sum in result.all()
    ]


async def _fetch_latest_title(db: AsyncSession, normalized_url: str) -> str | None:
    result = await db.execute(
        select(ExplorationEvent.title)
        .where(ExplorationEvent.normalized_url == normalized_url)
        .order_by(ExplorationEvent.visited_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _fetch_repeat_visits(db: AsyncSession, start: datetime) -> list[RepeatVisitItem]:
    """normalized_url 기준 2회 이상 방문 top5 — title은 최신 방문의 title."""
    result = await db.execute(
        select(ExplorationEvent.normalized_url, func.count().label("visit_count"))
        .where(
            ExplorationEvent.sync_status != "discarded",
            ExplorationEvent.visited_at >= start,
        )
        .group_by(ExplorationEvent.normalized_url)
        .having(func.count() >= _MIN_REPEAT_COUNT)
        .order_by(func.count().desc())
        .limit(_TOP_N)
    )
    rows = result.all()
    items: list[RepeatVisitItem] = []
    for normalized_url, visit_count in rows:
        title = await _fetch_latest_title(db, normalized_url)
        items.append(
            RepeatVisitItem(normalized_url=normalized_url, title=title, visit_count=visit_count)
        )
    return items


async def _fetch_repeat_search_queries(db: AsyncSession, start: datetime) -> list[RepeatSearchQueryItem]:
    """search_query 기준 2회 이상 반복 검색어 top5."""
    result = await db.execute(
        select(ExplorationEvent.search_query, func.count().label("cnt"))
        .where(
            ExplorationEvent.sync_status != "discarded",
            ExplorationEvent.visited_at >= start,
            ExplorationEvent.search_query.is_not(None),
        )
        .group_by(ExplorationEvent.search_query)
        .having(func.count() >= _MIN_REPEAT_COUNT)
        .order_by(func.count().desc())
        .limit(_TOP_N)
    )
    return [
        RepeatSearchQueryItem(search_query=search_query, count=count)
        for search_query, count in result.all()
    ]


async def _fetch_daily_trend(db: AsyncSession, start: datetime) -> list[DailyTrendItem]:
    """일자별 이벤트 수/총 탐색 시간(날짜 오름차순)."""
    day = func.date(ExplorationEvent.visited_at)
    result = await db.execute(
        select(
            day.label("day"),
            func.count().label("event_count"),
            func.coalesce(func.sum(ExplorationEvent.active_duration_ms), 0).label("duration_sum"),
        )
        .where(
            ExplorationEvent.sync_status != "discarded",
            ExplorationEvent.visited_at >= start,
        )
        .group_by(day)
        .order_by(day.asc())
    )
    return [
        DailyTrendItem(
            date=day_value.isoformat() if hasattr(day_value, "isoformat") else str(day_value),
            event_count=event_count,
            total_active_duration_ms=duration_sum,
        )
        for day_value, event_count, duration_sum in result.all()
    ]


@router.get("/analytics/overview", response_model=AnalyticsOverviewResponse)
async def get_analytics_overview(
    days: int = Query(7, ge=1, le=90),
    db: AsyncSession = Depends(get_db),
) -> AnalyticsOverviewResponse:
    start = _period_start(days)

    top_sessions = await _fetch_top_sessions(db, start)
    top_domains = await _fetch_top_domains(db, start)
    repeat_visits = await _fetch_repeat_visits(db, start)
    repeat_search_queries = await _fetch_repeat_search_queries(db, start)
    daily_trend = await _fetch_daily_trend(db, start)

    return AnalyticsOverviewResponse(
        period_days=days,
        top_sessions_by_duration=top_sessions,
        top_domains=top_domains,
        repeat_visits=repeat_visits,
        repeat_search_queries=repeat_search_queries,
        daily_trend=daily_trend,
    )
