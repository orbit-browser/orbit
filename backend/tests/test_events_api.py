import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api import events
from app.api.events import _build_event_rows
from app.schemas.event import ExplorationEventIn, EventListItem

VALID_UUID_1 = "b3f1c2a0-1111-4a2b-9c3d-000000000001"
VALID_UUID_2 = "b3f1c2a0-1111-4a2b-9c3d-000000000002"
VALID_UUID_3 = "b3f1c2a0-1111-4a2b-9c3d-000000000003"


def _event(**overrides) -> ExplorationEventIn:
    base = {
        "id": VALID_UUID_1,
        "url": "https://www.google.com/search?q=rtx+5070+review",
        "title": "rtx 5070 review - Google 검색",
        "visited_at": "2026-08-03T05:12:00Z",
    }
    base.update(overrides)
    return ExplorationEventIn(**base)


def test_system_url_is_filtered_and_not_stored():
    events = [_event(url="chrome://extensions")]
    rows, filtered = _build_event_rows(events, batch_device_id=None)
    assert rows == []
    assert filtered == 1


def test_non_system_url_is_stored_and_not_filtered():
    events = [_event()]
    rows, filtered = _build_event_rows(events, batch_device_id=None)
    assert len(rows) == 1
    assert filtered == 0


def test_filtered_count_only_counts_system_urls():
    events = [
        _event(id=VALID_UUID_1, url="chrome://newtab"),
        _event(id=VALID_UUID_2),
        _event(id=VALID_UUID_3, url="about:blank"),
    ]
    rows, filtered = _build_event_rows(events, batch_device_id=None)
    assert filtered == 2
    assert len(rows) == 1
    assert rows[0]["id"] == VALID_UUID_2


def test_sensitive_url_clears_content_excerpt_but_keeps_event():
    events = [
        _event(
            url="https://www.kbstar.com/main",
            content_excerpt="account balance details",
        )
    ]
    rows, filtered = _build_event_rows(events, batch_device_id=None)
    assert filtered == 0
    assert len(rows) == 1
    assert rows[0]["content_excerpt"] == ""
    assert rows[0]["content_hash"] == ""


def test_non_sensitive_url_keeps_content_excerpt_and_hash():
    from app.services.event_filter import content_hash

    events = [_event(content_excerpt="some article body")]
    rows, _ = _build_event_rows(events, batch_device_id=None)
    assert rows[0]["content_excerpt"] == "some article body"
    assert rows[0]["content_hash"] == content_hash("some article body")


def test_content_excerpt_is_capped_at_5000_chars():
    long_text = "a" * 6000
    events = [_event(content_excerpt=long_text)]
    rows, _ = _build_event_rows(events, batch_device_id=None)
    assert len(rows[0]["content_excerpt"]) == 5000
    assert rows[0]["content_excerpt"] == "a" * 5000


def test_title_is_capped_at_500_chars():
    long_title = "t" * 600
    events = [_event(title=long_title)]
    rows, _ = _build_event_rows(events, batch_device_id=None)
    assert len(rows[0]["title"]) == 500


def test_empty_title_becomes_none():
    events = [_event(title="")]
    rows, _ = _build_event_rows(events, batch_device_id=None)
    assert rows[0]["title"] is None


def test_device_id_prefers_event_level_over_batch_level():
    events = [_event(device_id="event-device")]
    rows, _ = _build_event_rows(events, batch_device_id="batch-device")
    assert rows[0]["device_id"] == "event-device"


def test_device_id_falls_back_to_batch_level():
    events = [_event(device_id=None)]
    rows, _ = _build_event_rows(events, batch_device_id="batch-device")
    assert rows[0]["device_id"] == "batch-device"


def test_normalized_url_domain_and_search_query_are_computed():
    events = [_event(url="https://www.google.com/search?utm_source=x&q=rtx+5070+review")]
    rows, _ = _build_event_rows(events, batch_device_id=None)
    row = rows[0]
    assert row["domain"] == "www.google.com"
    assert row["search_query"] == "rtx 5070 review"
    assert row["normalized_url"] == "https://www.google.com/search?q=rtx+5070+review"


def test_non_search_url_has_no_search_query():
    events = [_event(url="https://example.com/article/1")]
    rows, _ = _build_event_rows(events, batch_device_id=None)
    assert rows[0]["search_query"] is None


# ── GET /events?date= (docs/api-design-v2.md §3) ────────────────────────


def test_resolve_date_range_today_uses_injected_now():
    now = datetime(2026, 8, 3, 5, 12, tzinfo=timezone.utc)
    start, end = events._resolve_date_range("today", now=now)
    assert start == datetime(2026, 8, 3, 0, 0, tzinfo=timezone.utc)
    assert end == datetime(2026, 8, 4, 0, 0, tzinfo=timezone.utc)


def test_resolve_date_range_parses_explicit_iso_date():
    start, end = events._resolve_date_range("2026-07-20")
    assert start == datetime(2026, 7, 20, 0, 0, tzinfo=timezone.utc)
    assert end == datetime(2026, 7, 21, 0, 0, tzinfo=timezone.utc)


def test_resolve_date_range_rejects_invalid_format():
    with pytest.raises(ValueError):
        events._resolve_date_range("not-a-date")


class _AllResult:
    def __init__(self, items):
        self._items = items

    def all(self):
        return self._items


class _FakeQueryDB:
    def __init__(self, result):
        self._result = result

    async def execute(self, _stmt):
        return self._result


def test_fetch_events_for_date_maps_fields_for_unassigned_event():
    visited_at = datetime(2026, 8, 3, 5, 12, tzinfo=timezone.utc)
    event = SimpleNamespace(
        id="e1", url="https://a", title="A", domain="a.com",
        visited_at=visited_at, active_duration_ms=1000,
    )
    db = _FakeQueryDB(_AllResult([(event, None, None)]))

    items = asyncio.run(events._fetch_events_for_date(db, visited_at, visited_at))

    assert len(items) == 1
    assert items[0].event_id == "e1"
    assert items[0].session_id is None
    assert items[0].session_title is None


def test_fetch_events_for_date_includes_session_badge_when_assigned():
    visited_at = datetime(2026, 8, 3, 5, 12, tzinfo=timezone.utc)
    event = SimpleNamespace(
        id="e2", url="https://b", title="B", domain="b.com",
        visited_at=visited_at, active_duration_ms=2000,
    )
    db = _FakeQueryDB(_AllResult([(event, "sess-1", "RTX 5070 구매 비교")]))

    items = asyncio.run(events._fetch_events_for_date(db, visited_at, visited_at))

    assert items[0].session_id == "sess-1"
    assert items[0].session_title == "RTX 5070 구매 비교"


def test_fetch_events_for_date_dedupes_duplicate_join_rows():
    visited_at = datetime(2026, 8, 3, 5, 12, tzinfo=timezone.utc)
    event = SimpleNamespace(
        id="e3", url="https://c", title="C", domain="c.com",
        visited_at=visited_at, active_duration_ms=None,
    )
    db = _FakeQueryDB(_AllResult([(event, "sess-1", "s"), (event, "sess-1", "s")]))

    items = asyncio.run(events._fetch_events_for_date(db, visited_at, visited_at))

    assert len(items) == 1


def test_list_events_rejects_invalid_date():
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(events.list_events(date="bad-date", db=None))
    assert exc_info.value.status_code == 400


def test_list_events_delegates_to_fetch_with_resolved_range(monkeypatch):
    captured = {}

    async def fake_fetch(_db, start, end):
        captured["start"] = start
        captured["end"] = end
        return [EventListItem(event_id="e1", url="https://a", visited_at="2026-08-03T05:12:00+00:00")]

    monkeypatch.setattr(events, "_fetch_events_for_date", fake_fetch)

    items = asyncio.run(events.list_events(date="2026-08-03", db=None))

    assert captured["start"] == datetime(2026, 8, 3, 0, 0, tzinfo=timezone.utc)
    assert captured["end"] == datetime(2026, 8, 4, 0, 0, tzinfo=timezone.utc)
    assert len(items) == 1


# ── DELETE /events/{id} (docs/api-design-v2.md §10) ─────────────────────


class _FakeDeleteDB:
    def __init__(self, event=None, affected_session_ids=None):
        self._event = event
        self._affected = affected_session_ids or []
        self.deleted = []
        self.committed = False

    async def get(self, _model, _id):
        return self._event

    async def execute(self, _stmt):
        return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: self._affected))

    async def delete(self, obj):
        self.deleted.append(obj)

    async def commit(self):
        self.committed = True


def test_delete_event_404_when_missing():
    db = _FakeDeleteDB(event=None)
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(events.delete_event(event_id="missing", db=db))
    assert exc_info.value.status_code == 404


def test_delete_event_removes_event_and_recomputes_each_affected_session(monkeypatch):
    event = SimpleNamespace(id="e1")
    db = _FakeDeleteDB(event=event, affected_session_ids=["sess-1"])

    recompute_calls = []

    async def fake_recompute(_db, session_id):
        recompute_calls.append(session_id)

    monkeypatch.setattr(events, "_recompute_session_after_event_removed", fake_recompute)

    asyncio.run(events.delete_event(event_id="e1", db=db))

    assert db.deleted == [event]
    assert recompute_calls == ["sess-1"]
    assert db.committed is True


def test_delete_event_skips_recompute_when_event_unassigned(monkeypatch):
    event = SimpleNamespace(id="e1")
    db = _FakeDeleteDB(event=event, affected_session_ids=[])

    recompute_calls = []

    async def fake_recompute(_db, session_id):
        recompute_calls.append(session_id)

    monkeypatch.setattr(events, "_recompute_session_after_event_removed", fake_recompute)

    asyncio.run(events.delete_event(event_id="e1", db=db))

    assert recompute_calls == []
    assert db.committed is True


def test_recompute_session_after_event_removed_updates_counters_and_resyncs_tabs(monkeypatch):
    session = SimpleNamespace(id="sess-1", event_count=5, total_active_duration_ms=10000)

    class _FakeRecomputeDB:
        def __init__(self):
            self._queue = [
                SimpleNamespace(scalar_one=lambda: 4),
                SimpleNamespace(scalar_one=lambda: 8000),
            ]

        async def get(self, _model, _id):
            return session

        async def execute(self, _stmt):
            return self._queue.pop(0)

    resync_calls = []

    async def fake_resync(_db, session_id):
        resync_calls.append(session_id)

    monkeypatch.setattr(events, "_resync_tabs", fake_resync)

    asyncio.run(events._recompute_session_after_event_removed(_FakeRecomputeDB(), "sess-1"))

    assert session.event_count == 4
    assert session.total_active_duration_ms == 8000
    assert resync_calls == ["sess-1"]


def test_recompute_session_after_event_removed_noop_when_session_missing():
    class _FakeMissingDB:
        async def get(self, _model, _id):
            return None

        async def execute(self, _stmt):
            raise AssertionError("session이 없으면 집계 쿼리를 실행하면 안 됨")

    asyncio.run(events._recompute_session_after_event_removed(_FakeMissingDB(), "missing"))
