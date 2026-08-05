import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.services import sync_pipeline


class _FakeSessionLocalCtx:
    def __init__(self, db):
        self._db = db

    async def __aenter__(self):
        return self._db

    async def __aexit__(self, *_exc):
        return False


class _ScalarsResult:
    def __init__(self, items):
        self._items = items

    def scalars(self):
        return SimpleNamespace(all=lambda: self._items)


class _QueuedDB:
    """execute() 호출 순서대로 미리 준비한 결과를 반환하는 스크립트 기반 fake DB."""

    def __init__(self, results):
        self._results = list(results)

    async def execute(self, _stmt):
        return self._results.pop(0)


@pytest.fixture(autouse=True)
def _reset_lock():
    """테스트가 실패해도 다음 테스트에 락이 걸린 채로 남지 않도록 보장한다."""
    yield
    if sync_pipeline._batch_lock.locked():
        sync_pipeline._batch_lock.release()


# ── 락/동시성 ──────────────────────────────────────────────


def test_is_running_reflects_lock_state():
    assert sync_pipeline.is_running() is False

    async def scenario():
        await sync_pipeline._batch_lock.acquire()
        assert sync_pipeline.is_running() is True
        sync_pipeline._batch_lock.release()

    asyncio.run(scenario())
    assert sync_pipeline.is_running() is False


def test_run_batch_raises_running_error_when_lock_held(monkeypatch):
    async def fake_get_running_id():
        return "existing-batch"

    monkeypatch.setattr(sync_pipeline, "_get_running_batch_id", fake_get_running_id)

    async def scenario():
        await sync_pipeline._batch_lock.acquire()
        try:
            with pytest.raises(sync_pipeline.SyncBatchRunningError) as exc_info:
                await sync_pipeline.run_batch("manual")
            assert exc_info.value.batch_id == "existing-batch"
        finally:
            sync_pipeline._batch_lock.release()

    asyncio.run(scenario())


def test_run_batch_no_pending_completes_batch_and_returns_none(monkeypatch):
    calls: dict = {"complete": []}

    async def fake_create_batch_row(_trigger_type):
        return "batch-1"

    async def fake_claim(_batch_id):
        return []

    async def fake_complete(batch_id, event_count, model=None):
        calls["complete"].append((batch_id, event_count, model))

    monkeypatch.setattr(sync_pipeline, "_create_batch_row", fake_create_batch_row)
    monkeypatch.setattr(sync_pipeline, "_claim_pending_events", fake_claim)
    monkeypatch.setattr(sync_pipeline, "_complete_batch", fake_complete)

    result = asyncio.run(sync_pipeline.run_batch("manual"))

    assert result is None
    assert calls["complete"] == [("batch-1", 0, None)]
    assert sync_pipeline.is_running() is False


def test_run_batch_claim_failure_fails_batch_and_releases_lock(monkeypatch):
    async def fake_create_batch_row(_trigger_type):
        return "batch-1"

    async def fake_claim(_batch_id):
        raise RuntimeError("db down")

    fail_calls = []

    async def fake_fail(batch_id, exc):
        fail_calls.append((batch_id, str(exc)))

    monkeypatch.setattr(sync_pipeline, "_create_batch_row", fake_create_batch_row)
    monkeypatch.setattr(sync_pipeline, "_claim_pending_events", fake_claim)
    monkeypatch.setattr(sync_pipeline, "_fail_batch", fake_fail)

    with pytest.raises(RuntimeError, match="db down"):
        asyncio.run(sync_pipeline.run_batch("manual"))

    assert fail_calls == [("batch-1", "db down")]
    assert sync_pipeline.is_running() is False


def test_run_batch_returns_immediately_and_holds_lock_until_background_done(monkeypatch):
    started = asyncio.Event()
    gate = asyncio.Event()
    process_calls = []

    async def fake_create_batch_row(_trigger_type):
        return "batch-1"

    async def fake_claim(_batch_id):
        return [{"id": "e1"}]

    async def fake_process_batch(batch_id, claimed):
        started.set()
        await gate.wait()
        process_calls.append((batch_id, claimed))

    monkeypatch.setattr(sync_pipeline, "_create_batch_row", fake_create_batch_row)
    monkeypatch.setattr(sync_pipeline, "_claim_pending_events", fake_claim)
    monkeypatch.setattr(sync_pipeline, "_process_batch", fake_process_batch)

    async def scenario():
        batch_id = await sync_pipeline.run_batch("manual")
        assert batch_id == "batch-1"

        await started.wait()
        # 백그라운드 처리가 끝나지 않았으므로 락은 계속 유지돼야 한다.
        assert sync_pipeline.is_running() is True

        gate.set()
        for _ in range(200):
            if not sync_pipeline.is_running():
                break
            await asyncio.sleep(0.01)

        assert sync_pipeline.is_running() is False
        assert process_calls == [("batch-1", [{"id": "e1"}])]

    asyncio.run(scenario())


# ── _process_batch: 그룹 실패 격리 ──────────────────────────────────


def test_process_batch_reverts_only_failed_group_and_completes(monkeypatch):
    calls: dict = {"set_status": [], "complete": [], "refresh": []}

    def fake_dedupe(events):
        return events, []

    groups = [[{"id": "a"}], [{"id": "b"}]]

    def fake_group_by_time_gap(_events, gap_minutes, max_group_size):
        return groups

    async def fake_process_group(group, _batch_id, touched):
        if group[0]["id"] == "a":
            raise RuntimeError("group boom")
        touched.add("sess-ok")
        return "model-x"

    async def fake_set_status(event_ids, status):
        calls["set_status"].append((event_ids, status))

    async def fake_refresh(session_id):
        calls["refresh"].append(session_id)

    async def fake_complete(batch_id, event_count, model=None):
        calls["complete"].append((batch_id, event_count, model))

    monkeypatch.setattr(sync_pipeline, "dedupe_events", fake_dedupe)
    monkeypatch.setattr(sync_pipeline, "group_by_time_gap", fake_group_by_time_gap)
    monkeypatch.setattr(sync_pipeline, "_process_group", fake_process_group)
    monkeypatch.setattr(sync_pipeline, "_set_status", fake_set_status)
    monkeypatch.setattr(sync_pipeline, "refresh_session_ai", fake_refresh)
    monkeypatch.setattr(sync_pipeline, "_complete_batch", fake_complete)

    asyncio.run(sync_pipeline._process_batch("batch-1", [{"id": "a"}, {"id": "b"}]))

    assert (["a"], "pending") in calls["set_status"]
    assert calls["refresh"] == ["sess-ok"]
    # 감사 필드는 그룹별 모델 카운트 요약(성공 그룹 1개 → "model-x:1")
    assert calls["complete"] == [("batch-1", 2, "model-x:1")]


def test_process_batch_marks_dedupe_discarded_ids_processed(monkeypatch):
    calls: dict = {"set_status": []}

    def fake_dedupe(events):
        return events[:1], ["dup-1"]

    async def fake_set_status(event_ids, status):
        calls["set_status"].append((event_ids, status))

    async def fake_complete(*_a, **_k):
        pass

    monkeypatch.setattr(sync_pipeline, "dedupe_events", fake_dedupe)
    monkeypatch.setattr(sync_pipeline, "group_by_time_gap", lambda *a, **k: [])
    monkeypatch.setattr(sync_pipeline, "_set_status", fake_set_status)
    monkeypatch.setattr(sync_pipeline, "_complete_batch", fake_complete)

    asyncio.run(sync_pipeline._process_batch("batch-1", [{"id": "a"}]))

    assert (["dup-1"], "processed") in calls["set_status"]


def test_process_batch_exception_fails_batch(monkeypatch):
    def boom(_events):
        raise RuntimeError("dedupe exploded")

    fail_calls = []

    async def fake_fail(batch_id, exc):
        fail_calls.append((batch_id, str(exc)))

    monkeypatch.setattr(sync_pipeline, "dedupe_events", boom)
    monkeypatch.setattr(sync_pipeline, "_fail_batch", fake_fail)

    asyncio.run(sync_pipeline._process_batch("batch-1", [{"id": "a"}]))

    assert fail_calls == [("batch-1", "dedupe exploded")]


# ── 순수 헬퍼 ──────────────────────────────────────────────


def test_summarize_models_counts_and_shortens():
    # EXAONE 긴 라벨은 "exaone"으로 축약, 카운트 내림차순
    summary = sync_pipeline._summarize_models(
        {"exaone/LGAI-EXAONE/K-EXAONE-236B-A23B": 12, "A.X-K1": 3}
    )
    assert summary == "exaone:12,A.X-K1:3"
    assert sync_pipeline._summarize_models({}) is None
    assert len(sync_pipeline._summarize_models({"exaone/x": 1, "A.X-K1": 1})) <= 50


def test_group_embedding_text_joins_title_and_domain():
    group = [
        {"title": "제목1", "domain": "a.com"},
        {"title": "제목2", "domain": "b.com"},
        {"title": None, "domain": None},
    ]
    text = sync_pipeline._group_embedding_text(group)
    assert text == "제목1 a.com 제목2 b.com"


def test_sessions_to_candidates_formats_expected_fields():
    session = SimpleNamespace(
        id="s1",
        title="세션 제목",
        summary={"overview": "개요"},
        keywords=["k1", "k2"],
        last_activity_at=datetime.now(timezone.utc) - timedelta(days=3),
        created_at=datetime.now(timezone.utc) - timedelta(days=10),
    )
    candidates = sync_pipeline._sessions_to_candidates([session])
    assert candidates == [
        {
            "session_id": "s1",
            "title": "세션 제목",
            "overview": "개요",
            "keywords": ["k1", "k2"],
            "last_activity_days_ago": 3,
        }
    ]


def test_sessions_to_candidates_handles_missing_summary_and_keywords():
    # last_activity_at이 없는 snapshot 세션은 created_at으로 경과일을 계산한다
    session = SimpleNamespace(
        id="s1",
        title="제목",
        summary=None,
        keywords=None,
        last_activity_at=None,
        created_at=datetime.now(timezone.utc),
    )
    candidates = sync_pipeline._sessions_to_candidates([session])
    assert candidates == [
        {
            "session_id": "s1",
            "title": "제목",
            "overview": "",
            "keywords": [],
            "last_activity_days_ago": 0,
        }
    ]


# ── _fetch_candidates: 벡터 검색 실패 시 최근 활성 세션으로 폴백 ──────────


def test_fetch_candidates_falls_back_when_vector_search_fails(monkeypatch):
    async def failing_search(*_a, **_k):
        raise RuntimeError("qdrant down")

    monkeypatch.setattr(sync_pipeline, "search_similar_with_scores", failing_search)

    recent_session = SimpleNamespace(
        id="sess-recent",
        title="최근 세션",
        summary={"overview": "ov"},
        keywords=["k"],
        last_activity_at=datetime.now(timezone.utc),
        created_at=datetime.now(timezone.utc),
    )
    db = _QueuedDB(
        [
            _ScalarsResult(["sess-recent"]),  # 최근 활성 세션 id 조회
            _ScalarsResult([recent_session]),  # id로 세션 본문 조회
        ]
    )
    monkeypatch.setattr(sync_pipeline, "AsyncSessionLocal", lambda: _FakeSessionLocalCtx(db))

    candidates = asyncio.run(sync_pipeline._fetch_candidates([0.1, 0.2]))

    assert candidates == [
        {
            "session_id": "sess-recent",
            "title": "최근 세션",
            "overview": "ov",
            "keywords": ["k"],
            "last_activity_days_ago": 0,
        }
    ]


def test_fetch_candidates_returns_empty_when_no_candidates_found(monkeypatch):
    async def empty_search(*_a, **_k):
        return []

    monkeypatch.setattr(sync_pipeline, "search_similar_with_scores", empty_search)

    db = _QueuedDB([_ScalarsResult([])])
    monkeypatch.setattr(sync_pipeline, "AsyncSessionLocal", lambda: _FakeSessionLocalCtx(db))

    candidates = asyncio.run(sync_pipeline._fetch_candidates([0.1, 0.2]))
    assert candidates == []


# ── _process_group ──────────────────────────────────────────────


def _group_event(id_: str, url: str = "https://example.com/a") -> dict:
    return {
        "id": id_,
        "url": url,
        "title": "title",
        "domain": "example.com",
        "visited_at": datetime(2026, 8, 3, 5, 0, tzinfo=timezone.utc),
    }


def test_process_group_discards_system_urls_and_skips_when_all_filtered(monkeypatch):
    async def boom_embed(*_a, **_k):
        raise AssertionError("모두 필터링된 그룹은 임베딩을 호출하면 안 됨")

    discard_calls = []

    async def fake_set_status(event_ids, status):
        discard_calls.append((event_ids, status))

    monkeypatch.setattr(sync_pipeline, "embed", boom_embed)
    monkeypatch.setattr(sync_pipeline, "_set_status", fake_set_status)

    group = [_group_event("a", url="chrome://newtab")]
    touched: set[str] = set()

    result = asyncio.run(sync_pipeline._process_group(group, "batch-1", touched))

    assert result is None
    assert touched == set()
    assert discard_calls == [(["a"], "discarded")]


def test_process_group_wires_embed_candidates_analyze_and_apply(monkeypatch):
    calls: dict = {}

    async def fake_embed(text, **kwargs):
        calls["embed_text"] = text
        calls["embed_kwargs"] = kwargs
        return [0.1, 0.2]

    async def fake_fetch_candidates(vector):
        calls["candidates_vector"] = vector
        return [{"session_id": "s1", "title": "t", "overview": "o", "keywords": []}]

    async def fake_analyze(group, candidates):
        calls["analyze_args"] = (group, candidates)
        return [SimpleNamespace(model=None)]

    async def fake_apply_assignments(db, group, assignments, batch_id):
        calls["apply_args"] = (group, assignments, batch_id)
        return {"sess-touched"}

    monkeypatch.setattr(sync_pipeline, "embed", fake_embed)
    monkeypatch.setattr(sync_pipeline, "_fetch_candidates", fake_fetch_candidates)
    monkeypatch.setattr(sync_pipeline.intent_analyzer, "analyze", fake_analyze)
    monkeypatch.setattr(sync_pipeline, "apply_assignments", fake_apply_assignments)
    monkeypatch.setattr(sync_pipeline, "AsyncSessionLocal", lambda: _FakeSessionLocalCtx(db=object()))

    group = [_group_event("a")]
    touched: set[str] = set()

    result = asyncio.run(sync_pipeline._process_group(group, "batch-1", touched))

    # embed는 embedding-query(기본값)를 써야 한다 — model 파라미터를 넘기면 안 됨(비대칭 임베딩 규칙)
    assert "model" not in calls["embed_kwargs"]
    assert calls["candidates_vector"] == [0.1, 0.2]
    assert calls["analyze_args"] == (group, [{"session_id": "s1", "title": "t", "overview": "o", "keywords": []}])
    assert calls["apply_args"][2] == "batch-1"
    assert touched == {"sess-touched"}
    assert result is None  # analyze가 반환한 assignment의 model이 None이므로 감사 모델도 비어있음
