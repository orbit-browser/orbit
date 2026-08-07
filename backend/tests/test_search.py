import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException

from app.api import search
from app.schemas.session import SessionDetail, SessionSummary


def run_search(monkeypatch, embed_result):
    async def fake_embed(_query):
        if isinstance(embed_result, Exception):
            raise embed_result
        return embed_result

    monkeypatch.setattr(search, "embed", fake_embed)
    return asyncio.run(search.search_sessions(q="query", limit=5, rerank=False, db=None, user_id="u1"))


@pytest.mark.parametrize(
    ("error", "expected_status"),
    [
        (httpx.ReadTimeout("timeout"), 504),
        (httpx.ConnectError("unavailable"), 503),
        (KeyError("embedding"), 502),
    ],
)
def test_search_maps_embedding_failures(monkeypatch, error, expected_status):
    with pytest.raises(HTTPException) as exc_info:
        run_search(monkeypatch, error)

    assert exc_info.value.status_code == expected_status


def test_search_maps_embedding_upstream_error(monkeypatch):
    request = httpx.Request("POST", "https://embedding.example")
    response = httpx.Response(429, request=request)
    error = httpx.HTTPStatusError("rate limited", request=request, response=response)

    with pytest.raises(HTTPException) as exc_info:
        run_search(monkeypatch, error)

    assert exc_info.value.status_code == 502


def test_search_maps_vector_store_failure(monkeypatch):
    async def failing_search(_vector, *, limit):
        raise RuntimeError(f"qdrant unavailable for limit={limit}")

    monkeypatch.setattr(search, "search_similar", failing_search)

    with pytest.raises(HTTPException) as exc_info:
        run_search(monkeypatch, [0.1, 0.2])

    assert exc_info.value.status_code == 503


def test_search_returns_empty_when_no_points_match(monkeypatch):
    async def empty_search(_vector, *, limit):
        assert limit == 5
        return []

    monkeypatch.setattr(search, "search_similar", empty_search)

    assert run_search(monkeypatch, [0.1, 0.2]) == []


# ── scope=memory ──────────────────────────────────────────────────────


def _session_detail(session_id="sess-1", title="세션") -> SessionDetail:
    return SessionDetail(
        session_id=session_id,
        title=title,
        summary=SessionSummary(overview="overview"),
        summary_status="done",
        tabs=[],
        created_at="2026-07-20T10:00:00+00:00",
        updated_at="2026-07-25T09:00:00+00:00",
    )


class _AllResult:
    def __init__(self, items):
        self._items = items

    def all(self):
        return self._items


class _FakeDB:
    def __init__(self, result):
        self._result = result

    async def execute(self, _stmt):
        return self._result


def test_score_session_event_none_relevance_treated_as_zero():
    assert search._score_session_event(None, 1000) == 0.0


def test_score_session_event_none_duration_treated_as_one():
    assert search._score_session_event(0.5, None) == 0.5


def test_score_session_event_multiplies_relevance_and_duration():
    assert search._score_session_event(0.5, 1000) == 500.0


def test_select_session_relevance_events_caps_per_session_at_three():
    rows = [{"session_id": "s1", "event_id": f"s1-{i}", "_score": 10 - i} for i in range(5)]
    top = search._select_session_relevance_events(rows)
    assert [r["event_id"] for r in top] == ["s1-0", "s1-1", "s1-2"]


def test_select_session_relevance_events_caps_overall_at_ten():
    rows = [
        {"session_id": f"s{i}", "event_id": f"e{i}", "_score": 100 - i} for i in range(20)
    ]
    top = search._select_session_relevance_events(rows)
    assert len(top) == 10
    assert [r["event_id"] for r in top[:3]] == ["e0", "e1", "e2"]


def test_fetch_session_relevance_events_returns_empty_without_db_call_when_no_sessions():
    async def scenario():
        return await search._fetch_session_relevance_events(db=None, session_ids=[])

    assert asyncio.run(scenario()) == []


def test_fetch_session_relevance_events_maps_orm_rows_and_scores():
    visited_at = datetime(2026, 7, 20, 10, 5, tzinfo=timezone.utc)
    session_event = SimpleNamespace(session_id="sess-1", relevance_score=0.74)
    event = SimpleNamespace(
        id="c1a2", url="https://a", title="A", domain="a.com",
        visited_at=visited_at, active_duration_ms=2000,
    )
    db = _FakeDB(_AllResult([(session_event, event, "일본 도쿄 여행 준비")]))

    result = asyncio.run(search._fetch_session_relevance_events(db, ["sess-1"]))

    assert result == [
        {
            "event_id": "c1a2",
            "url": "https://a",
            "title": "A",
            "domain": "a.com",
            "visited_at": visited_at,
            "active_duration_ms": 2000,
            "session_id": "sess-1",
            "session_title": "일본 도쿄 여행 준비",
            "_score": 0.74 * 2000,
        }
    ]


def test_fetch_keyword_matched_events_excludes_ids_already_matched_by_session():
    visited_at = datetime(2026, 7, 19, 21, 0, tzinfo=timezone.utc)
    excluded_event = SimpleNamespace(
        id="e1", url="https://a", title="A", domain="a.com", visited_at=visited_at, active_duration_ms=None
    )
    kept_event = SimpleNamespace(
        id="e2", url="https://b", title="도쿄 여행 - 네이버 검색", domain="search.naver.com",
        visited_at=visited_at, active_duration_ms=None,
    )
    rows = [(excluded_event, None, None), (kept_event, "sess-2", "일본 여행")]
    db = _FakeDB(_AllResult(rows))

    result = asyncio.run(search._fetch_keyword_matched_events(db, "도쿄", exclude_ids={"e1"}, user_id="u1"))

    assert [r["event_id"] for r in result] == ["e2"]
    assert result[0]["session_id"] == "sess-2"
    assert result[0]["session_title"] == "일본 여행"


def test_fetch_keyword_matched_events_caps_at_ten():
    visited_at = datetime(2026, 7, 19, 21, 0, tzinfo=timezone.utc)
    rows = [
        (
            SimpleNamespace(
                id=f"e{i}", url="https://x", title="X", domain="x.com",
                visited_at=visited_at, active_duration_ms=None,
            ),
            None,
            None,
        )
        for i in range(15)
    ]
    db = _FakeDB(_AllResult(rows))

    result = asyncio.run(search._fetch_keyword_matched_events(db, "q", exclude_ids=set(), user_id="u1"))

    assert len(result) == 10


def test_search_memory_events_tags_session_then_keyword_and_dedupes(monkeypatch):
    visited_at = datetime(2026, 7, 20, 10, 5, tzinfo=timezone.utc)

    async def fake_relevance(_db, session_ids):
        assert session_ids == ["sess-1"]
        return [
            {
                "event_id": "e1", "url": "https://a", "title": "A", "domain": "a.com",
                "visited_at": visited_at, "active_duration_ms": 1000,
                "session_id": "sess-1", "session_title": "세션 하나",
            }
        ]

    async def fake_keyword(_db, _q, exclude_ids, _user_id):
        assert exclude_ids == {"e1"}
        return [
            {
                "event_id": "e2", "url": "https://b", "title": "B", "domain": "b.com",
                "visited_at": visited_at, "active_duration_ms": None,
                "session_id": None, "session_title": None,
            }
        ]

    monkeypatch.setattr(search, "_fetch_session_relevance_events", fake_relevance)
    monkeypatch.setattr(search, "_fetch_keyword_matched_events", fake_keyword)

    events = asyncio.run(
        search._search_memory_events(db=None, q="query", sessions=[_session_detail("sess-1")], user_id="u1")
    )

    assert [e.event_id for e in events] == ["e1", "e2"]
    assert events[0].matched_by == "session"
    assert events[0].session_title == "세션 하나"
    assert events[1].matched_by == "keyword"
    assert events[1].session_id is None


def test_search_sessions_scope_memory_wraps_sessions_and_events(monkeypatch):
    session = _session_detail()

    async def fake_by_vector(_q, _limit, _rerank, _db, _user_id):
        return [session]

    async def fake_memory_events(_db, _q, _sessions, _user_id):
        return []

    monkeypatch.setattr(search, "_search_sessions_by_vector", fake_by_vector)
    monkeypatch.setattr(search, "_search_memory_events", fake_memory_events)

    response = asyncio.run(
        search.search_sessions(q="query", limit=5, rerank=False, scope="memory", db=None, user_id="u1")
    )

    assert response.sessions == [session]
    assert response.events == []


def test_search_sessions_scope_memory_event_query_failure_still_returns_sessions(monkeypatch):
    session = _session_detail()

    async def fake_by_vector(_q, _limit, _rerank, _db, _user_id):
        return [session]

    async def failing_memory_events(_db, _q, _sessions):
        raise RuntimeError("db down")

    monkeypatch.setattr(search, "_search_sessions_by_vector", fake_by_vector)
    monkeypatch.setattr(search, "_search_memory_events", failing_memory_events)

    response = asyncio.run(
        search.search_sessions(q="query", limit=5, rerank=False, scope="memory", db=None, user_id="u1")
    )

    assert response.sessions == [session]
    assert response.events == []


def test_search_sessions_scope_sessions_default_returns_bare_list(monkeypatch):
    session = _session_detail()

    async def fake_by_vector(_q, _limit, _rerank, _db, _user_id):
        return [session]

    monkeypatch.setattr(search, "_search_sessions_by_vector", fake_by_vector)

    response = asyncio.run(search.search_sessions(q="query", limit=5, rerank=False, db=None, user_id="u1"))

    assert response == [session]
