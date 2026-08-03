import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.services import session_updater
from app.services.intent_analyzer import Assignment
from app.schemas.session import SessionSummary

_T0 = datetime(2026, 8, 3, 5, 0, tzinfo=timezone.utc)


def _event(id_: str, minutes: int = 0, active_duration_ms: int = 1000, **overrides) -> dict:
    base = {
        "id": id_,
        "visited_at": datetime(2026, 8, 3, 5, minutes, tzinfo=timezone.utc),
        "active_duration_ms": active_duration_ms,
        "title": f"title-{id_}",
        "domain": "example.com",
        "url": f"https://example.com/{id_}",
    }
    base.update(overrides)
    return base


# ── 순수 함수 ──────────────────────────────────────────────


def test_fallback_title_single_event_capped_at_20_chars():
    events = [_event("a", title="아주 긴 제목이라서 스무 글자를 넘길 수도 있는 이벤트 제목입니다")]
    title = session_updater._fallback_title(events)
    assert title == events[0]["title"][:20]


def test_fallback_title_multiple_events():
    events = [_event("a", title="첫 이벤트"), _event("b"), _event("c")]
    assert session_updater._fallback_title(events) == "첫 이벤트 외 2개"


def test_fallback_title_uses_domain_when_title_missing():
    events = [_event("a", title=None, domain="news.com")]
    assert session_updater._fallback_title(events) == "news.com"


def test_hold_forces_create_threshold():
    assert session_updater._hold_forces_create(2) is False
    assert session_updater._hold_forces_create(3) is True
    assert session_updater._hold_forces_create(4) is True


def test_select_representative_tabs_orders_by_relevance_desc_then_sequence():
    pairs = [
        {"event_id": "a", "relevance_score": 0.5, "sequence_order": 0, "title": "A", "url": "https://a"},
        {"event_id": "b", "relevance_score": 0.9, "sequence_order": 1, "title": "B", "url": "https://b"},
        {"event_id": "c", "relevance_score": 0.9, "sequence_order": 0, "title": "C", "url": "https://c"},
        {"event_id": "d", "relevance_score": None, "sequence_order": 2, "title": "D", "url": "https://d"},
    ]
    tabs = session_updater._select_representative_tabs(pairs)
    assert [t["tab_id"] for t in tabs] == ["c", "b", "a", "d"]
    assert tabs[0]["fav_icon_url"] is None


def test_select_representative_tabs_caps_at_limit():
    pairs = [
        {"event_id": str(i), "relevance_score": 1.0, "sequence_order": i, "title": "t", "url": "u"}
        for i in range(25)
    ]
    tabs = session_updater._select_representative_tabs(pairs)
    assert len(tabs) == 20


def test_select_refresh_candidates_orders_by_relevance_times_duration():
    pairs = [
        {"event_id": "a", "relevance_score": 0.5, "active_duration_ms": 1000, "title": "a", "url": "u", "content_excerpt": ""},
        {"event_id": "b", "relevance_score": 0.9, "active_duration_ms": 100000, "title": "b", "url": "u", "content_excerpt": ""},
        {"event_id": "c", "relevance_score": None, "active_duration_ms": None, "title": "c", "url": "u", "content_excerpt": ""},
    ]
    top = session_updater._select_refresh_candidates(pairs, limit=2)
    assert [p["event_id"] for p in top] == ["b", "a"]


def test_select_refresh_candidates_zero_duration_treated_as_one():
    # active_duration_ms=0이어도 max(duration,1)로 완전히 0점 처리되지 않는다
    pairs = [
        {"event_id": "a", "relevance_score": 0.8, "active_duration_ms": 0, "title": "a", "url": "u", "content_excerpt": ""},
    ]
    top = session_updater._select_refresh_candidates(pairs, limit=1)
    assert top[0]["event_id"] == "a"


# ── apply_assignments 디스패치(협력 함수 모킹) ──────────────────────


class _FakeDB:
    def __init__(self):
        self.committed = False

    async def commit(self):
        self.committed = True


def _patch_collaborators(monkeypatch, *, hold_counts=None):
    calls: dict = {"create": [], "append": [], "resync": [], "mark": []}

    async def fake_create(db, events, title, purpose, relevance):
        session_id = f"created-{len(calls['create'])}"
        calls["create"].append((events, title, purpose, relevance))
        return session_id

    async def fake_append(db, session_id, events, relevance):
        calls["append"].append((session_id, events, relevance))
        return session_id

    async def fake_mark(db, event_ids, status):
        calls["mark"].append((event_ids, status))

    async def fake_increment(db, event_ids):
        calls.setdefault("increment", []).append(event_ids)
        counts = hold_counts or {}
        return {eid: counts.get(eid, 1) for eid in event_ids}

    async def fake_resync(db, session_id):
        calls["resync"].append(session_id)

    monkeypatch.setattr(session_updater, "_create_session", fake_create)
    monkeypatch.setattr(session_updater, "_append_to_session", fake_append)
    monkeypatch.setattr(session_updater, "_mark_events_status", fake_mark)
    monkeypatch.setattr(session_updater, "_increment_hold_count", fake_increment)
    monkeypatch.setattr(session_updater, "_resync_tabs", fake_resync)
    return calls


def test_apply_assignments_discard_marks_status_and_does_not_touch_session(monkeypatch):
    calls = _patch_collaborators(monkeypatch)
    group = [_event("a")]
    assignments = [Assignment(event_indices=[0], action="discard", relevance=0.1)]

    touched = asyncio.run(session_updater.apply_assignments(_FakeDB(), group, assignments, "batch-1"))

    assert touched == set()
    assert calls["mark"] == [(["a"], "discarded")]
    assert calls["resync"] == []


def test_apply_assignments_create_touches_new_session_and_resyncs_tabs(monkeypatch):
    calls = _patch_collaborators(monkeypatch)
    group = [_event("a"), _event("b")]
    assignments = [Assignment(event_indices=[0, 1], action="create", title="제목", purpose="목적", relevance=0.7)]

    touched = asyncio.run(session_updater.apply_assignments(_FakeDB(), group, assignments, "batch-1"))

    assert touched == {"created-0"}
    assert calls["create"][0][1] == "제목"
    assert calls["resync"] == ["created-0"]


def test_apply_assignments_append_uses_target_session(monkeypatch):
    calls = _patch_collaborators(monkeypatch)
    group = [_event("a")]
    assignments = [Assignment(event_indices=[0], action="append", target="sess-1", relevance=0.6)]

    touched = asyncio.run(session_updater.apply_assignments(_FakeDB(), group, assignments, "batch-1"))

    assert touched == {"sess-1"}
    assert calls["append"][0][0] == "sess-1"
    assert calls["create"] == []


def test_apply_assignments_append_without_target_falls_back_to_create(monkeypatch):
    calls = _patch_collaborators(monkeypatch)
    group = [_event("a")]
    assignments = [Assignment(event_indices=[0], action="append", target=None, relevance=0.6)]

    touched = asyncio.run(session_updater.apply_assignments(_FakeDB(), group, assignments, "batch-1"))

    assert touched == {"created-0"}
    assert calls["append"] == []


def test_apply_assignments_hold_below_threshold_does_not_create(monkeypatch):
    calls = _patch_collaborators(monkeypatch, hold_counts={"a": 1})
    group = [_event("a")]
    assignments = [Assignment(event_indices=[0], action="hold", relevance=0.0)]

    touched = asyncio.run(session_updater.apply_assignments(_FakeDB(), group, assignments, "batch-1"))

    assert touched == set()
    assert calls["create"] == []


def test_apply_assignments_hold_at_threshold_forces_create(monkeypatch):
    calls = _patch_collaborators(monkeypatch, hold_counts={"a": 3})
    group = [_event("a")]
    assignments = [Assignment(event_indices=[0], action="hold", relevance=0.0)]

    touched = asyncio.run(session_updater.apply_assignments(_FakeDB(), group, assignments, "batch-1"))

    assert touched == {"created-0"}
    assert calls["create"][0][0] == group  # forced 이벤트 목록으로 create 호출


def test_apply_assignments_commits_once(monkeypatch):
    _patch_collaborators(monkeypatch)
    db = _FakeDB()
    group = [_event("a")]
    assignments = [Assignment(event_indices=[0], action="discard", relevance=0.0)]

    asyncio.run(session_updater.apply_assignments(db, group, assignments, "batch-1"))
    assert db.committed is True


# ── record_version ──────────────────────────────────────────────


class _FakeVersionResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeVersionDB:
    def __init__(self, max_version):
        self._max_version = max_version
        self.added = []

    async def execute(self, _stmt):
        return _FakeVersionResult(self._max_version)

    def add(self, obj):
        self.added.append(obj)


def test_record_version_increments_from_max():
    db = _FakeVersionDB(max_version=2)
    session = SimpleNamespace(id="sess-1", title="제목")
    summary = {"overview": "overview", "purpose": "purpose", "highlights": [], "todos": [], "next_actions": []}

    asyncio.run(session_updater.record_version(db, session, summary, "v1", "A.X-K1"))

    assert len(db.added) == 1
    version = db.added[0]
    assert version.version == 3
    assert version.session_id == "sess-1"
    assert version.prompt_version == "v1"
    assert version.model == "A.X-K1"


def test_record_version_starts_at_1_when_no_prior_version():
    db = _FakeVersionDB(max_version=None)
    session = SimpleNamespace(id="sess-1", title="제목")
    summary = {"overview": "overview"}

    asyncio.run(session_updater.record_version(db, session, summary, None, None))

    assert db.added[0].version == 1


# ── refresh_session_ai ──────────────────────────────────────────────


class _FakeRefreshDB:
    def __init__(self, session_obj):
        self._session_obj = session_obj

    async def get(self, _model, _id):
        return self._session_obj

    async def commit(self):
        pass

    def add(self, _obj):
        pass


class _FakeSessionLocalCtx:
    def __init__(self, db):
        self._db = db

    async def __aenter__(self):
        return self._db

    async def __aexit__(self, *_exc):
        return False


def _patch_refresh_collaborators(monkeypatch, *, session_obj, pairs, generate_summary_result=None, generate_summary_error=None):
    db = _FakeRefreshDB(session_obj)
    monkeypatch.setattr(session_updater, "AsyncSessionLocal", lambda: _FakeSessionLocalCtx(db))

    async def fake_fetch_pairs(_db, _session_id):
        return pairs

    monkeypatch.setattr(session_updater, "_fetch_session_event_pairs", fake_fetch_pairs)

    async def fake_generate_summary(_tabs):
        if generate_summary_error:
            raise generate_summary_error
        return generate_summary_result

    monkeypatch.setattr(session_updater, "generate_summary", fake_generate_summary)

    version_calls = []

    async def fake_record_version(_db, _session, summary_dict, prompt_version, model):
        version_calls.append((summary_dict, prompt_version, model))

    monkeypatch.setattr(session_updater, "record_version", fake_record_version)

    embed_calls = []

    async def fake_embed_and_upsert(session_id, title, summary):
        embed_calls.append((session_id, title, summary))

    monkeypatch.setattr(session_updater, "embed_and_upsert", fake_embed_and_upsert)

    return db, version_calls, embed_calls


def test_refresh_session_ai_success_updates_status_done_and_records_version(monkeypatch):
    session_obj = SimpleNamespace(id="sess-1", title="old", summary={}, summary_status="pending", updated_at=None)
    pairs = [
        {"event_id": "a", "relevance_score": 0.9, "active_duration_ms": 5000, "title": "A", "url": "https://a", "content_excerpt": "body"},
    ]
    summary = SessionSummary(overview="새 개요", purpose="목적")
    db, version_calls, embed_calls = _patch_refresh_collaborators(
        monkeypatch, session_obj=session_obj, pairs=pairs, generate_summary_result=("새 제목", summary)
    )

    asyncio.run(session_updater.refresh_session_ai("sess-1"))

    assert session_obj.summary_status == "done"
    assert session_obj.title == "새 제목"
    assert len(version_calls) == 1
    assert len(embed_calls) == 1
    assert embed_calls[0][0] == "sess-1"


def test_refresh_session_ai_failure_sets_status_failed_and_skips_embed(monkeypatch):
    session_obj = SimpleNamespace(id="sess-1", title="old", summary={}, summary_status="pending", updated_at=None)
    pairs = [
        {"event_id": "a", "relevance_score": 0.9, "active_duration_ms": 5000, "title": "A", "url": "https://a", "content_excerpt": "body"},
    ]
    db, version_calls, embed_calls = _patch_refresh_collaborators(
        monkeypatch, session_obj=session_obj, pairs=pairs, generate_summary_error=RuntimeError("llm down")
    )

    asyncio.run(session_updater.refresh_session_ai("sess-1"))

    assert session_obj.summary_status == "failed"
    assert version_calls == []
    assert embed_calls == []


def test_refresh_session_ai_no_session_events_sets_failed(monkeypatch):
    session_obj = SimpleNamespace(id="sess-1", title="old", summary={}, summary_status="pending", updated_at=None)
    db, version_calls, embed_calls = _patch_refresh_collaborators(
        monkeypatch, session_obj=session_obj, pairs=[]
    )

    asyncio.run(session_updater.refresh_session_ai("sess-1"))

    assert session_obj.summary_status == "failed"
    assert version_calls == []
    assert embed_calls == []


def test_refresh_session_ai_missing_session_is_noop(monkeypatch):
    db, version_calls, embed_calls = _patch_refresh_collaborators(
        monkeypatch, session_obj=None, pairs=[]
    )

    # db.get 이 항상 None을 반환하므로 아무 것도 하지 않고 조용히 종료해야 함
    asyncio.run(session_updater.refresh_session_ai("missing"))

    assert version_calls == []
    assert embed_calls == []
