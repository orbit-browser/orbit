"""추천 캐시 정책 — 새 탭을 열 때마다 LLM을 부르지 않는지 확인한다.

이 테스트가 무너지면 API 비용이 새 탭 열람 횟수에 비례해 늘어난다.
"""

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.config import settings
from app.services.recommender import service
from app.services.recommender.llm_rerank import RecommendationContext

_CONTEXT = RecommendationContext()


class _FakeDB:
    """`_read_cache` 만 쓰는 최소 대역."""

    def __init__(self, cached=None):
        self._cached = cached
        self.committed = False

    async def scalar(self, _stmt):
        return self._cached

    async def execute(self, _stmt):
        return None

    async def commit(self):
        self.committed = True


_DEFAULT_ITEMS = object()


def _cache_row(minutes_ago: int, items=_DEFAULT_ITEMS):
    """`items=None` 을 '기본값'이 아니라 '실제로 None 인 컬럼'으로 넘길 수 있게 sentinel 을 쓴다."""
    return SimpleNamespace(
        user_id="u1",
        items=[{"session_id": "s1", "title": "t"}] if items is _DEFAULT_ITEMS else items,
        computed_at=datetime.now(timezone.utc) - timedelta(minutes=minutes_ago),
    )


def _stub_compute(monkeypatch, result, calls: list):
    async def fake(_db, user_id, _context):
        calls.append(user_id)
        return result

    monkeypatch.setattr(service, "compute_recommendations", fake)


def _stub_no_background(monkeypatch, scheduled: list):
    monkeypatch.setattr(
        service, "_schedule_refresh", lambda user_id, context: scheduled.append(user_id)
    )


def test_fresh_cache_is_returned_without_recomputing(monkeypatch):
    calls: list = []
    scheduled: list = []
    _stub_compute(monkeypatch, [{"session_id": "new"}], calls)
    _stub_no_background(monkeypatch, scheduled)

    db = _FakeDB(_cache_row(minutes_ago=1))
    items, computed_at, is_stale = asyncio.run(service.get_recommendations(db, "u1", _CONTEXT))

    assert items == [{"session_id": "s1", "title": "t"}]
    assert is_stale is False
    assert calls == [], "신선한 캐시인데 다시 계산했다 — LLM 비용이 새어나간다"
    assert scheduled == []
    assert computed_at is not None


def test_stale_cache_is_returned_immediately_and_refreshed_in_background(monkeypatch):
    calls: list = []
    scheduled: list = []
    _stub_compute(monkeypatch, [{"session_id": "new"}], calls)
    _stub_no_background(monkeypatch, scheduled)

    stale_minutes = settings.recommendation_ttl_minutes + 5
    db = _FakeDB(_cache_row(minutes_ago=stale_minutes))
    items, _computed_at, is_stale = asyncio.run(service.get_recommendations(db, "u1", _CONTEXT))

    # 사용자는 기다리지 않는다 — 옛 결과를 즉시 받는다.
    assert items == [{"session_id": "s1", "title": "t"}]
    assert is_stale is True
    assert calls == [], "요청 경로에서 동기 계산이 일어났다 — 새 탭이 느려진다"
    assert scheduled == ["u1"], "백그라운드 재계산이 예약되지 않았다"


def test_first_request_computes_synchronously(monkeypatch):
    """캐시가 아예 없으면 빈 화면 대신 그 자리에서 계산한다."""
    calls: list = []
    scheduled: list = []
    _stub_compute(monkeypatch, [{"session_id": "first"}], calls)
    _stub_no_background(monkeypatch, scheduled)

    db = _FakeDB(None)
    items, computed_at, is_stale = asyncio.run(service.get_recommendations(db, "u1", _CONTEXT))

    assert items == [{"session_id": "first"}]
    assert calls == ["u1"]
    assert is_stale is False
    assert computed_at is not None
    assert db.committed is True


def test_ttl_boundary_counts_as_stale(monkeypatch):
    calls: list = []
    scheduled: list = []
    _stub_compute(monkeypatch, [], calls)
    _stub_no_background(monkeypatch, scheduled)

    db = _FakeDB(_cache_row(minutes_ago=settings.recommendation_ttl_minutes))
    _items, _computed_at, is_stale = asyncio.run(service.get_recommendations(db, "u1", _CONTEXT))

    assert is_stale is True


def test_empty_cached_items_still_returns_list(monkeypatch):
    calls: list = []
    scheduled: list = []
    _stub_compute(monkeypatch, [], calls)
    _stub_no_background(monkeypatch, scheduled)

    db = _FakeDB(_cache_row(minutes_ago=1, items=None))
    items, _computed_at, _is_stale = asyncio.run(service.get_recommendations(db, "u1", _CONTEXT))

    assert items == []


def test_ttl_comes_from_settings(monkeypatch):
    monkeypatch.setattr(settings, "recommendation_ttl_minutes", 5)
    assert service._ttl() == timedelta(minutes=5)


# ── 신호 추출 ──────────────────────────────────────────────


def test_open_task_count_sums_todos_and_next_actions():
    summary = {"todos": ["a", "b"], "next_actions": ["c"]}
    assert service._open_task_count(summary) == 3


def test_open_task_count_handles_missing_and_malformed():
    assert service._open_task_count(None) == 0
    assert service._open_task_count({}) == 0
    assert service._open_task_count({"todos": "not-a-list"}) == 0


def test_context_overlap_is_zero_without_context():
    session = SimpleNamespace(title="아반떼 비교", keywords=["아반떼"])
    assert service._context_overlap(session, RecommendationContext()) == 0.0


def test_context_overlap_detects_keyword_match():
    session = SimpleNamespace(title="자동차 유지비", keywords=["아반떼", "k3"])
    context = RecommendationContext(current_title="아반떼 하이브리드 가격표")

    assert service._context_overlap(session, context) > 0


def test_context_overlap_is_zero_when_nothing_matches():
    session = SimpleNamespace(title="교토 여행", keywords=["료칸"])
    context = RecommendationContext(current_title="파이썬 타입 힌트")

    assert service._context_overlap(session, context) == 0.0
