import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

from app.api import analytics

_NOW = datetime(2026, 8, 3, 12, 0, tzinfo=timezone.utc)


class _AllResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _ScalarsResult:
    def __init__(self, items):
        self._items = items

    def scalars(self):
        return SimpleNamespace(all=lambda: self._items)


class _ScalarOneResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _QueuedDB:
    """execute() 호출 순서대로 미리 준비한 결과를 반환하는 fake DB (test_sync_pipeline.py 컨벤션)."""

    def __init__(self, results):
        self._results = list(results)

    async def execute(self, _stmt):
        return self._results.pop(0)


# ── _period_start ──────────────────────────────────────────────


def test_period_start_subtracts_days_from_now():
    start = analytics._period_start(7, now=_NOW)
    assert start == datetime(2026, 7, 27, 12, 0, tzinfo=timezone.utc)


def test_period_start_defaults_to_current_time_when_now_not_given():
    before = datetime.now(timezone.utc)
    start = analytics._period_start(1)
    after = datetime.now(timezone.utc)
    assert before - analytics.timedelta(days=1) <= start <= after - analytics.timedelta(days=1)


# ── _fetch_top_sessions ──────────────────────────────────────────────


def test_fetch_top_sessions_maps_fields():
    session = SimpleNamespace(
        id="s1", title="RTX 5070 구매 비교", total_active_duration_ms=28800000, event_count=12
    )
    db = _QueuedDB([_ScalarsResult([session])])

    items = asyncio.run(analytics._fetch_top_sessions(db, _NOW, "u1"))

    assert items == [
        analytics.TopSessionItem(
            session_id="s1", title="RTX 5070 구매 비교", total_active_duration_ms=28800000, event_count=12
        )
    ]


def test_fetch_top_sessions_empty_when_no_rows():
    db = _QueuedDB([_ScalarsResult([])])
    items = asyncio.run(analytics._fetch_top_sessions(db, _NOW, "u1"))
    assert items == []


# ── _fetch_top_domains ──────────────────────────────────────────────


def test_fetch_top_domains_maps_fields():
    db = _QueuedDB([_AllResult([("github.com", 42, 120000), ("google.com", 31, 60000)])])

    items = asyncio.run(analytics._fetch_top_domains(db, _NOW, "u1"))

    assert items == [
        analytics.TopDomainItem(domain="github.com", visit_count=42, total_active_duration_ms=120000),
        analytics.TopDomainItem(domain="google.com", visit_count=31, total_active_duration_ms=60000),
    ]


# ── _fetch_repeat_visits (2단계: 집계 → 최신 title 조회) ──────────────


def test_fetch_repeat_visits_looks_up_latest_title_per_url():
    db = _QueuedDB(
        [
            _AllResult([("https://docs.python.org/3/", 5)]),
            _ScalarOneResult("Python 공식 문서"),
        ]
    )

    items = asyncio.run(analytics._fetch_repeat_visits(db, _NOW, "u1"))

    assert items == [
        analytics.RepeatVisitItem(
            normalized_url="https://docs.python.org/3/", title="Python 공식 문서", visit_count=5
        )
    ]


def test_fetch_repeat_visits_handles_multiple_urls_in_order():
    db = _QueuedDB(
        [
            _AllResult([("https://a.com/", 3), ("https://b.com/", 2)]),
            _ScalarOneResult("A"),
            _ScalarOneResult("B"),
        ]
    )

    items = asyncio.run(analytics._fetch_repeat_visits(db, _NOW, "u1"))

    assert [i.normalized_url for i in items] == ["https://a.com/", "https://b.com/"]
    assert [i.title for i in items] == ["A", "B"]


def test_fetch_repeat_visits_empty_when_no_repeats():
    db = _QueuedDB([_AllResult([])])
    items = asyncio.run(analytics._fetch_repeat_visits(db, _NOW, "u1"))
    assert items == []


# ── _fetch_repeat_search_queries ──────────────────────────────────────────────


def test_fetch_repeat_search_queries_maps_fields():
    db = _QueuedDB([_AllResult([("rtx 5070 가격", 4)])])

    items = asyncio.run(analytics._fetch_repeat_search_queries(db, _NOW, "u1"))

    assert items == [analytics.RepeatSearchQueryItem(search_query="rtx 5070 가격", count=4)]


def test_fetch_repeat_search_queries_empty_when_no_repeats():
    db = _QueuedDB([_AllResult([])])
    items = asyncio.run(analytics._fetch_repeat_search_queries(db, _NOW, "u1"))
    assert items == []


# ── _fetch_daily_trend ──────────────────────────────────────────────


def test_fetch_daily_trend_maps_date_objects_to_isoformat():
    import datetime as dt

    db = _QueuedDB(
        [
            _AllResult(
                [
                    (dt.date(2026, 7, 28), 55, 7200000),
                    (dt.date(2026, 7, 29), 40, 5400000),
                ]
            )
        ]
    )

    items = asyncio.run(analytics._fetch_daily_trend(db, _NOW, "u1"))

    assert items == [
        analytics.DailyTrendItem(date="2026-07-28", event_count=55, total_active_duration_ms=7200000),
        analytics.DailyTrendItem(date="2026-07-29", event_count=40, total_active_duration_ms=5400000),
    ]


def test_fetch_daily_trend_handles_non_date_objects_via_str_fallback():
    db = _QueuedDB([_AllResult([("2026-07-28", 10, 1000)])])
    items = asyncio.run(analytics._fetch_daily_trend(db, _NOW, "u1"))
    assert items[0].date == "2026-07-28"


def test_fetch_daily_trend_empty_when_no_events():
    db = _QueuedDB([_AllResult([])])
    items = asyncio.run(analytics._fetch_daily_trend(db, _NOW, "u1"))
    assert items == []


# ── get_analytics_overview (엔드포인트 핸들러 와이어링) ──────────────


def test_get_analytics_overview_wires_all_sections_together(monkeypatch):
    async def fake_top_sessions(_db, _start, _user_id):
        return [
            analytics.TopSessionItem(session_id="s1", title="t", total_active_duration_ms=1, event_count=1)
        ]

    async def fake_top_domains(_db, _start, _user_id):
        return [analytics.TopDomainItem(domain="a.com", visit_count=1, total_active_duration_ms=1)]

    async def fake_repeat_visits(_db, _start, _user_id):
        return [analytics.RepeatVisitItem(normalized_url="https://a.com/", title="A", visit_count=2)]

    async def fake_repeat_search_queries(_db, _start, _user_id):
        return [analytics.RepeatSearchQueryItem(search_query="q", count=2)]

    async def fake_daily_trend(_db, _start, _user_id):
        return [analytics.DailyTrendItem(date="2026-07-28", event_count=1, total_active_duration_ms=1)]

    monkeypatch.setattr(analytics, "_fetch_top_sessions", fake_top_sessions)
    monkeypatch.setattr(analytics, "_fetch_top_domains", fake_top_domains)
    monkeypatch.setattr(analytics, "_fetch_repeat_visits", fake_repeat_visits)
    monkeypatch.setattr(analytics, "_fetch_repeat_search_queries", fake_repeat_search_queries)
    monkeypatch.setattr(analytics, "_fetch_daily_trend", fake_daily_trend)

    response = asyncio.run(analytics.get_analytics_overview(days=7, db=object(), user_id="u1"))

    assert response.period_days == 7
    assert len(response.top_sessions_by_duration) == 1
    assert len(response.top_domains) == 1
    assert len(response.repeat_visits) == 1
    assert len(response.repeat_search_queries) == 1
    assert len(response.daily_trend) == 1


def test_analytics_router_registers_overview_route():
    paths = {route.path for route in analytics.router.routes}
    assert "/analytics/overview" in paths
