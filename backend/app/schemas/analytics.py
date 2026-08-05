"""GET /analytics/overview 응답 스키마 (docs/api-design-v2.md §9).

필드명은 문서(§9)를 그대로 따른다. total_active_duration_ms(top_sessions_by_duration의
event_count, top_domains의 total_active_duration_ms)는 문서에 없는 추가 필드이며,
호출자 지시(구현 계약)에 따라 최소 집계 항목으로 포함한다.
"""

from pydantic import BaseModel


class TopSessionItem(BaseModel):
    session_id: str
    title: str
    total_active_duration_ms: int
    event_count: int


class TopDomainItem(BaseModel):
    domain: str
    visit_count: int
    total_active_duration_ms: int


class RepeatVisitItem(BaseModel):
    normalized_url: str
    title: str | None = None
    visit_count: int


class RepeatSearchQueryItem(BaseModel):
    search_query: str
    count: int


class DailyTrendItem(BaseModel):
    date: str
    event_count: int
    total_active_duration_ms: int


class AnalyticsOverviewResponse(BaseModel):
    period_days: int
    top_sessions_by_duration: list[TopSessionItem]
    top_domains: list[TopDomainItem]
    repeat_visits: list[RepeatVisitItem]
    repeat_search_queries: list[RepeatSearchQueryItem]
    daily_trend: list[DailyTrendItem]
