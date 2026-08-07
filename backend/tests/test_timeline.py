import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api import sessions

# ── fake DB helpers (test_sync_pipeline.py의 _QueuedDB/_ScalarsResult 관례와 동일) ──


class _AllResult:
    def __init__(self, items):
        self._items = items

    def all(self):
        return self._items


class _ScalarsResult:
    def __init__(self, items):
        self._items = items

    def scalars(self):
        return SimpleNamespace(all=lambda: self._items)


class _FakeDB:
    def __init__(self, session=None, execute_result=None):
        self._session = session
        self._execute_result = execute_result

    async def get(self, _model, _id):
        return self._session

    async def execute(self, _stmt):
        return self._execute_result


# ── GET /sessions/{id}/events ──────────────────────────────────────────


def test_get_session_events_404_when_session_missing():
    db = _FakeDB(session=None)
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(sessions.get_session_events(session_id="missing", db=db, user_id="u1"))
    assert exc_info.value.status_code == 404


def test_get_session_events_returns_empty_for_snapshot_session():
    session = SimpleNamespace(id="s1", user_id="u1")
    db = _FakeDB(session=session, execute_result=_AllResult([]))

    items = asyncio.run(sessions.get_session_events(session_id="s1", db=db, user_id="u1"))

    assert items == []


def test_get_session_events_maps_fields_in_sequence_order():
    session = SimpleNamespace(id="s1", user_id="u1")
    visited_at = datetime(2026, 8, 3, 5, 12, tzinfo=timezone.utc)
    event = SimpleNamespace(
        id="e1",
        url="https://www.google.com/search?q=rtx+5070",
        title="rtx 5070 review",
        domain="google.com",
        visited_at=visited_at,
        active_duration_ms=150000,
    )
    session_event = SimpleNamespace(relevance_score=0.82, sequence_order=0)
    db = _FakeDB(session=session, execute_result=_AllResult([(session_event, event)]))

    items = asyncio.run(sessions.get_session_events(session_id="s1", db=db, user_id="u1"))

    assert len(items) == 1
    item = items[0]
    assert item.event_id == "e1"
    assert item.url == event.url
    assert item.title == "rtx 5070 review"
    assert item.domain == "google.com"
    assert item.visited_at == visited_at.isoformat()
    assert item.active_duration_ms == 150000
    assert item.relevance_score == 0.82
    assert item.sequence_order == 0


# ── GET /sessions/{id}/versions ─────────────────────────────────────────


def test_get_session_versions_404_when_session_missing():
    db = _FakeDB(session=None)
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(sessions.get_session_versions(session_id="missing", db=db, user_id="u1"))
    assert exc_info.value.status_code == 404


def test_get_session_versions_returns_empty_when_no_versions_yet():
    session = SimpleNamespace(id="s1", user_id="u1")
    db = _FakeDB(session=session, execute_result=_ScalarsResult([]))

    items = asyncio.run(sessions.get_session_versions(session_id="s1", db=db, user_id="u1"))

    assert items == []


def test_get_session_versions_maps_fields_and_keeps_desc_order_from_query():
    session = SimpleNamespace(id="s1", user_id="u1")
    created_at_v2 = datetime(2026, 8, 3, 5, 30, tzinfo=timezone.utc)
    created_at_v1 = datetime(2026, 8, 3, 5, 14, tzinfo=timezone.utc)
    v2 = SimpleNamespace(
        version=2,
        title="RTX 5070 구매 비교",
        overview="overview",
        purpose="purpose",
        highlights=["a"],
        todos=["b"],
        next_actions=["c"],
        model="A.X-K1",
        created_at=created_at_v2,
    )
    v1 = SimpleNamespace(
        version=1,
        title="그래픽카드 알아보기",
        overview="",
        purpose="",
        highlights=[],
        todos=[],
        next_actions=[],
        model="A.X-K1",
        created_at=created_at_v1,
    )
    # 정렬 자체는 SQL의 order_by(version.desc())가 담당하므로 fake는 이미 정렬된 순서로 반환
    db = _FakeDB(session=session, execute_result=_ScalarsResult([v2, v1]))

    items = asyncio.run(sessions.get_session_versions(session_id="s1", db=db, user_id="u1"))

    assert [i.version for i in items] == [2, 1]
    assert items[0].title == "RTX 5070 구매 비교"
    assert items[0].model == "A.X-K1"
    assert items[0].created_at == created_at_v2.isoformat()
