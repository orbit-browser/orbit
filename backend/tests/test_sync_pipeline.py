import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.services import sync_pipeline
from app.services.subject_splitter import SplitResult


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
        return [], None

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
        # 배치는 (이벤트, 소유자) 를 함께 돌려준다 — 한 배치는 한 사용자만 처리
        return [{"id": "e1"}], "u1"

    async def fake_process_batch(batch_id, claimed, user_id):
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
    calls: dict = {"set_status": [], "complete": [], "refresh": [], "invalidate": []}

    def fake_dedupe(events):
        return events, []

    groups = [[{"id": "a"}], [{"id": "b"}]]

    def fake_group_by_time_gap(_events, gap_minutes, max_group_size):
        return groups

    async def fake_process_group(group, _batch_id, touched, _user_id):
        if group[0]["id"] == "a":
            raise RuntimeError("group boom")
        touched.add("sess-ok")
        return ["model-x"]

    async def fake_set_status(event_ids, status):
        calls["set_status"].append((event_ids, status))

    async def fake_refresh(session_id):
        calls["refresh"].append(session_id)

    async def fake_complete(batch_id, event_count, model=None):
        calls["complete"].append((batch_id, event_count, model))

    async def fake_auto_merge_enabled(user_id):
        assert user_id == "u1"  # 배치 주인의 설정을 읽는다
        return False

    async def fake_invalidate_recommendations(user_id: str) -> None:
        calls["invalidate"].append(user_id)

    monkeypatch.setattr(sync_pipeline, "dedupe_events", fake_dedupe)
    monkeypatch.setattr(sync_pipeline, "group_by_time_gap", fake_group_by_time_gap)
    monkeypatch.setattr(sync_pipeline, "_process_group", fake_process_group)
    monkeypatch.setattr(sync_pipeline, "_set_status", fake_set_status)
    monkeypatch.setattr(sync_pipeline, "refresh_session_ai", fake_refresh)
    monkeypatch.setattr(sync_pipeline, "is_auto_merge_enabled", fake_auto_merge_enabled)
    _no_auto_folder(monkeypatch)
    monkeypatch.setattr(sync_pipeline, "invalidate_recommendations", fake_invalidate_recommendations)
    monkeypatch.setattr(sync_pipeline, "_complete_batch", fake_complete)

    asyncio.run(sync_pipeline._process_batch("batch-1", [{"id": "a"}, {"id": "b"}], "u1"))

    assert (["a"], "pending") in calls["set_status"]
    assert calls["refresh"] == ["sess-ok"]
    assert calls["invalidate"] == ["u1"]
    # 감사 필드는 그룹별 모델 카운트 요약(성공 그룹 1개 → "model-x:1")
    assert calls["complete"] == [("batch-1", 2, "model-x:1")]


def _no_auto_folder(monkeypatch):
    async def disabled(_user_id):
        return False

    monkeypatch.setattr(sync_pipeline, "is_auto_folder_enabled", disabled)

    async def no_recommendations(_user_id):
        return None

    monkeypatch.setattr(sync_pipeline, "invalidate_recommendations", no_recommendations)


def test_process_batch_auto_files_touched_sessions_and_merge_survivors(monkeypatch):
    filed: list[tuple[str, set[str]]] = []

    async def fake_process_group(_group, _batch_id, touched, _user_id):
        touched.update({"new", "absorbed"})
        return []

    async def noop(*_args, **_kwargs):
        return None

    async def enabled(_user_id):
        return True

    async def fake_auto_merge(_user_id):
        return {"survivor"}

    async def fake_auto_file(user_id, session_ids):
        filed.append((user_id, set(session_ids)))
        return 1

    monkeypatch.setattr(sync_pipeline, "dedupe_events", lambda events: (events, []))
    monkeypatch.setattr(sync_pipeline, "group_by_time_gap", lambda events, **_k: [events])
    monkeypatch.setattr(sync_pipeline, "_process_group", fake_process_group)
    monkeypatch.setattr(sync_pipeline, "refresh_session_ai", noop)
    monkeypatch.setattr(sync_pipeline, "is_auto_merge_enabled", enabled)
    monkeypatch.setattr(sync_pipeline, "_run_auto_merge", fake_auto_merge)
    monkeypatch.setattr(sync_pipeline, "is_auto_folder_enabled", enabled)
    monkeypatch.setattr(sync_pipeline, "auto_file_sessions", fake_auto_file)
    monkeypatch.setattr(sync_pipeline, "invalidate_recommendations", noop)
    monkeypatch.setattr(sync_pipeline, "_complete_batch", noop)

    asyncio.run(sync_pipeline._process_batch("batch-1", [{"id": "a"}], "u1"))

    assert filed == [("u1", {"new", "absorbed", "survivor"})]


def test_process_batch_marks_dedupe_discarded_ids_processed(monkeypatch):
    calls: dict = {"set_status": [], "invalidate": []}

    def fake_dedupe(events):
        return events[:1], ["dup-1"]

    async def fake_set_status(event_ids, status):
        calls["set_status"].append((event_ids, status))

    async def fake_complete(*_a, **_k):
        pass

    async def fake_auto_merge_enabled(user_id):
        assert user_id == "u1"  # 배치 주인의 설정을 읽는다
        return False

    async def fake_invalidate_recommendations(user_id: str) -> None:
        calls["invalidate"].append(user_id)

    monkeypatch.setattr(sync_pipeline, "dedupe_events", fake_dedupe)
    monkeypatch.setattr(sync_pipeline, "group_by_time_gap", lambda *a, **k: [])
    monkeypatch.setattr(sync_pipeline, "_set_status", fake_set_status)
    monkeypatch.setattr(sync_pipeline, "is_auto_merge_enabled", fake_auto_merge_enabled)
    _no_auto_folder(monkeypatch)
    monkeypatch.setattr(sync_pipeline, "invalidate_recommendations", fake_invalidate_recommendations)
    monkeypatch.setattr(sync_pipeline, "_complete_batch", fake_complete)

    asyncio.run(sync_pipeline._process_batch("batch-1", [{"id": "a"}], "u1"))

    assert (["dup-1"], "processed") in calls["set_status"]
    assert calls["invalidate"] == ["u1"]


def test_process_batch_exception_fails_batch(monkeypatch):
    def boom(_events):
        raise RuntimeError("dedupe exploded")

    fail_calls = []

    async def fake_fail(batch_id, exc):
        fail_calls.append((batch_id, str(exc)))

    monkeypatch.setattr(sync_pipeline, "dedupe_events", boom)
    monkeypatch.setattr(sync_pipeline, "_fail_batch", fake_fail)

    asyncio.run(sync_pipeline._process_batch("batch-1", [{"id": "a"}], "u1"))

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


def test_summarize_models_shortens_kt_fallback_label():
    summary = sync_pipeline._summarize_models({"A.X-K2": 5, "kt/midm-pro-fp8-kaic": 2})
    assert summary == "A.X-K2:5,kt:2"


def test_event_embedding_text_joins_title_domain_query():
    assert (
        sync_pipeline._event_embedding_text(
            {"title": "제목", "domain": "a.com", "search_query": "검색어"}
        )
        == "제목 a.com 검색어"
    )
    # 검색어 없으면 제목+도메인만, 빈 필드는 제외
    assert sync_pipeline._event_embedding_text({"title": "제목", "domain": None}) == "제목"
    assert sync_pipeline._event_embedding_text({"title": None, "domain": None}) == ""


def test_centroid_component_mean():
    assert sync_pipeline._centroid([[1.0, 3.0], [3.0, 1.0]]) == [2.0, 2.0]


# ── _gate_appends / _append_blocked ──────────────────────────────────


def _append_assignment(target):
    return SimpleNamespace(action="append", target=target)


def test_append_blocked_by_low_score():
    # score가 하한 미만이면 차단
    assert sync_pipeline._append_blocked({"score": 0.30, "last_activity_days_ago": 0}) is True
    # 하한 이상이면 통과
    assert sync_pipeline._append_blocked({"score": 0.55, "last_activity_days_ago": 0}) is False


def test_append_blocked_by_stale_recency():
    # 유사도는 충분해도 오래된 후보면 차단(append_max_age_days=3 기본)
    assert sync_pipeline._append_blocked({"score": 0.9, "last_activity_days_ago": 5}) is True


def test_append_blocked_when_score_none_and_recent():
    # 최근-only 후보는 주제 일치 근거가 없어 기존 세션에 붙이지 않는다.
    assert sync_pipeline._append_blocked({"score": None, "last_activity_days_ago": 0}) is True


def test_gate_appends_downgrades_low_similarity_to_create():
    assignments = [sync_pipeline.Assignment(event_indices=[0], action="append", target="s-far")]
    candidates = [{"session_id": "s-far", "score": 0.29, "last_activity_days_ago": 0}]

    gated = sync_pipeline._gate_appends(assignments, candidates)

    assert gated[0].action == "create"
    assert gated[0].target is None


def test_gate_appends_keeps_valid_append_and_ignores_non_append():
    good = sync_pipeline.Assignment(event_indices=[0], action="append", target="s-near")
    created = sync_pipeline.Assignment(event_indices=[1], action="create", target=None)
    candidates = [{"session_id": "s-near", "score": 0.7, "last_activity_days_ago": 0}]

    gated = sync_pipeline._gate_appends([good, created], candidates)

    assert gated[0].action == "append" and gated[0].target == "s-near"
    assert gated[1].action == "create"


def test_sessions_to_candidates_formats_expected_fields():
    session = SimpleNamespace(
        id="s1",
        title="세션 제목",
        summary={"overview": "개요"},
        keywords=["k1", "k2"],
        last_activity_at=datetime.now(timezone.utc) - timedelta(days=3),
        created_at=datetime.now(timezone.utc) - timedelta(days=10),
    )
    candidates = sync_pipeline._sessions_to_candidates([session], {"s1": 0.72})
    assert candidates == [
        {
            "session_id": "s1",
            "title": "세션 제목",
            "overview": "개요",
            "keywords": ["k1", "k2"],
            "last_activity_days_ago": 3,
            "score": 0.72,
        }
    ]


def test_sessions_to_candidates_handles_missing_summary_and_keywords():
    # last_activity_at이 없는 snapshot 세션은 created_at으로 경과일을 계산한다.
    # scores_by_id 미제공 시 score는 None(최근-only 후보와 동일 처리).
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
            "score": None,
        }
    ]


# ── _fetch_candidates: 벡터 검색 실패 시 최근 활성 세션으로 폴백 ──────────


def test_fetch_candidates_falls_back_when_vector_search_fails(monkeypatch):
    async def failing_search(*_a, **_k):
        raise RuntimeError("qdrant down")

    monkeypatch.setattr(sync_pipeline, "search_similar_with_scores", failing_search)
    monkeypatch.setattr(sync_pipeline, "score_sessions", failing_search)

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

    candidates = asyncio.run(sync_pipeline._fetch_candidates([0.1, 0.2], "u1"))

    assert candidates == [
        {
            "session_id": "sess-recent",
            "title": "최근 세션",
            "overview": "ov",
            "keywords": ["k"],
            "last_activity_days_ago": 0,
            # 벡터 검색 실패 시 최근 후보를 제공하되 append 게이트는 차단한다.
            "score": None,
        }
    ]


def test_fetch_candidates_returns_empty_when_no_candidates_found(monkeypatch):
    async def empty_search(*_a, **_k):
        return []

    monkeypatch.setattr(sync_pipeline, "search_similar_with_scores", empty_search)

    db = _QueuedDB([_ScalarsResult([])])
    monkeypatch.setattr(sync_pipeline, "AsyncSessionLocal", lambda: _FakeSessionLocalCtx(db))

    candidates = asyncio.run(sync_pipeline._fetch_candidates([0.1, 0.2], "u1"))
    assert candidates == []


def test_fetch_candidates_threads_vector_scores(monkeypatch):
    async def search(*_a, user_id, **_k):
        assert user_id == "u1"  # 벡터 후보도 그 사용자 포인트로만 뽑는다
        return [("sess-v", 0.63)]

    monkeypatch.setattr(sync_pipeline, "search_similar_with_scores", search)

    now = datetime.now(timezone.utc)
    v_session = SimpleNamespace(
        id="sess-v",
        title="벡터 후보",
        summary={"overview": "o"},
        keywords=[],
        last_activity_at=now,
        created_at=now,
    )
    db = _QueuedDB(
        [
            _ScalarsResult([]),  # 최근 활성 세션 없음
            _ScalarsResult([v_session]),  # id로 세션 본문 조회
        ]
    )
    monkeypatch.setattr(sync_pipeline, "AsyncSessionLocal", lambda: _FakeSessionLocalCtx(db))

    candidates = asyncio.run(sync_pipeline._fetch_candidates([0.1, 0.2], "u1"))

    assert candidates[0]["session_id"] == "sess-v"
    assert candidates[0]["score"] == 0.63


def test_fetch_candidates_scores_recent_only_sessions(monkeypatch):
    async def search(*_a, **_k):
        return []

    scored_ids = []

    async def score(_vector, session_ids, *, user_id, stream=None):
        scored_ids.append((list(session_ids), user_id))
        return {"sess-recent": 0.21}

    monkeypatch.setattr(sync_pipeline, "search_similar_with_scores", search)
    monkeypatch.setattr(sync_pipeline, "score_sessions", score)

    now = datetime.now(timezone.utc)
    recent_session = SimpleNamespace(
        id="sess-recent", title="최근 무관 세션", summary={}, keywords=[], last_activity_at=now, created_at=now
    )
    db = _QueuedDB([_ScalarsResult(["sess-recent"]), _ScalarsResult([recent_session])])
    monkeypatch.setattr(sync_pipeline, "AsyncSessionLocal", lambda: _FakeSessionLocalCtx(db))

    candidates = asyncio.run(sync_pipeline._fetch_candidates([0.1, 0.2], "u1"))

    assert scored_ids == [(["sess-recent"], "u1")]
    assert candidates[0]["score"] == 0.21
    # 점수가 붙었으니 게이트가 하한(0.35) 미달 append를 막는다
    assert sync_pipeline._append_blocked(candidates[0]) is True


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

    monkeypatch.setattr(sync_pipeline, "embed_many", boom_embed)
    monkeypatch.setattr(sync_pipeline, "_set_status", fake_set_status)

    group = [_group_event("a", url="chrome://newtab")]
    touched: set[str] = set()

    result = asyncio.run(sync_pipeline._process_group(group, "batch-1", touched, "u1"))

    assert result == []
    assert touched == set()
    assert discard_calls == [(["a"], "discarded")]


def test_process_group_single_cluster_wires_embed_candidates_analyze_and_apply(monkeypatch):
    calls: dict = {}

    async def fake_embed_many(texts, **kwargs):
        calls["embed_texts"] = texts
        calls["embed_kwargs"] = kwargs
        return [[0.1, 0.2] for _ in texts]

    async def fake_fetch_candidates(vector, _user_id, workspace_id=None):
        calls["candidates_vector"] = vector
        return [{"session_id": "s1", "title": "t", "overview": "o", "keywords": [], "score": 0.7}]

    async def fake_analyze(group, candidates):
        calls["analyze_args"] = (group, candidates)
        return [SimpleNamespace(action="create", target=None, model=None)]

    async def fake_apply_assignments(db, group, assignments, batch_id):
        calls["apply_args"] = (group, assignments, batch_id)
        return {"sess-touched"}

    monkeypatch.setattr(sync_pipeline, "embed_many", fake_embed_many)
    monkeypatch.setattr(sync_pipeline, "_fetch_candidates", fake_fetch_candidates)
    monkeypatch.setattr(sync_pipeline.intent_analyzer, "analyze", fake_analyze)
    monkeypatch.setattr(sync_pipeline, "apply_assignments", fake_apply_assignments)
    monkeypatch.setattr(sync_pipeline, "AsyncSessionLocal", lambda: _FakeSessionLocalCtx(db=object()))

    group = [_group_event("a")]
    touched: set[str] = set()

    result = asyncio.run(sync_pipeline._process_group(group, "batch-1", touched, "u1"))

    # embed_many는 embedding-query(기본값)를 써야 한다 — model 파라미터 금지(비대칭 임베딩 규칙)
    assert "model" not in calls["embed_kwargs"]
    # 단일주제 그룹 → 클러스터 1개 → centroid는 이벤트 벡터 그대로
    assert calls["candidates_vector"] == [0.1, 0.2]
    assert calls["analyze_args"][0] == group
    assert calls["apply_args"][2] == "batch-1"
    assert touched == {"sess-touched"}
    assert result == []  # model None → 감사 모델 비어있음


def test_process_group_hard_splits_multitopic_into_two_llm_calls(monkeypatch):
    """직교 임베딩 2개 → 서브클러스터 2개 → analyze/후보검색 각 2회, apply는 모든 검색 뒤(collect-then-apply)."""
    order: list[str] = []

    async def fake_embed_many(texts, **_kwargs):
        return [[1.0, 0.0], [0.0, 1.0]]  # 직교 → 분리

    async def fake_fetch_candidates(vector, _user_id, workspace_id=None):
        order.append("fetch")
        return []

    async def fake_analyze(group, candidates):
        order.append("analyze")
        return [SimpleNamespace(action="create", target=None, model="A.X-K1")]

    async def fake_apply_assignments(db, group, assignments, batch_id):
        order.append("apply")
        return {f"sess-{group[0]['id']}"}

    monkeypatch.setattr(sync_pipeline, "embed_many", fake_embed_many)
    monkeypatch.setattr(sync_pipeline, "_fetch_candidates", fake_fetch_candidates)
    monkeypatch.setattr(sync_pipeline.intent_analyzer, "analyze", fake_analyze)
    monkeypatch.setattr(sync_pipeline, "apply_assignments", fake_apply_assignments)
    monkeypatch.setattr(sync_pipeline, "AsyncSessionLocal", lambda: _FakeSessionLocalCtx(db=object()))

    group = [_group_event("a"), _group_event("b", url="https://other.com/x")]
    touched: set[str] = set()

    result = asyncio.run(sync_pipeline._process_group(group, "batch-1", touched, "u1"))

    # 모든 fetch/analyze가 apply보다 먼저 — 클러스터가 서로의 새 세션을 후보로 보지 못하게 함
    assert order == ["fetch", "analyze", "fetch", "analyze", "apply", "apply"]
    assert touched == {"sess-a", "sess-b"}
    assert result == ["A.X-K1", "A.X-K1"]


def test_fetch_candidates_passes_user_id_to_vector_search(monkeypatch):
    seen: dict = {}

    async def search(_vector, **kwargs):
        seen.update(kwargs)
        return []

    monkeypatch.setattr(sync_pipeline, "search_similar_with_scores", search)
    db = _QueuedDB([_ScalarsResult([])])
    monkeypatch.setattr(sync_pipeline, "AsyncSessionLocal", lambda: _FakeSessionLocalCtx(db))

    asyncio.run(sync_pipeline._fetch_candidates([0.1], "u1"))
    assert seen["user_id"] == "u1"


# ── 배치 안 동시 실행(perf/batch-parallel) ─────────────────────────────────


class _Concurrency:
    def __init__(self):
        self.running = 0
        self.peak = 0

    async def hold(self, seconds: float = 0.01):
        self.running += 1
        self.peak = max(self.peak, self.running)
        try:
            await asyncio.sleep(seconds)
        finally:
            self.running -= 1


def _group_fakes(monkeypatch, clusters, fetch=None):
    events = [
        {"id": f"e{i}", "url": f"https://example.com/{i}", "title": f"t{i}", "workspace_id": None}
        for i in range(sum(len(c) for c in clusters))
    ]
    applied: list[list[str]] = []

    async def embed_many(texts):
        return [[1.0, 0.0] for _ in texts]

    async def default_fetch(_centroid, _user_id, workspace_id=None):
        return []

    async def apply(_db, cluster_events, _assignments, _batch_id):
        applied.append([e["id"] for e in cluster_events])
        return set()

    async def no_status(*_args):
        return None

    monkeypatch.setattr(sync_pipeline, "split_noise", lambda group: (group, []))
    monkeypatch.setattr(sync_pipeline, "domain_counts", lambda _group: {})
    monkeypatch.setattr(sync_pipeline, "embed_many", embed_many)
    monkeypatch.setattr(sync_pipeline, "subcluster", lambda _emb, _threshold: clusters)
    monkeypatch.setattr(sync_pipeline, "_fetch_candidates", fetch or default_fetch)
    monkeypatch.setattr(sync_pipeline, "apply_assignments", apply)
    monkeypatch.setattr(sync_pipeline, "_set_status", no_status)
    monkeypatch.setattr(sync_pipeline, "AsyncSessionLocal", lambda: _FakeSessionLocalCtx(object()))
    return events, applied


def test_process_group_analyzes_two_clusters_at_a_time_and_applies_in_cluster_order(monkeypatch):
    clusters = [[0, 1], [2], [3, 4], [5]]
    events, applied = _group_fakes(monkeypatch, clusters)
    gauge = _Concurrency()

    async def analyze(cluster_events, _candidates):
        # 앞 클러스터가 더 오래 걸려도 반영 순서는 클러스터 순서여야 한다.
        await gauge.hold(0.04 if cluster_events[0]["id"] == "e0" else 0.01)
        return [sync_pipeline.Assignment(list(range(len(cluster_events))), "create", title="t", model="A.X-K2")]

    monkeypatch.setattr(sync_pipeline.intent_analyzer, "analyze", analyze)

    models = asyncio.run(sync_pipeline._process_group(events, "b1", set(), "u1"))

    assert gauge.peak == 2
    assert applied == [["e0", "e1"], ["e2"], ["e3", "e4"], ["e5"]]
    assert models == ["A.X-K2"] * 4


def test_process_group_fails_whole_group_after_all_clusters_finish(monkeypatch):
    finished: list[str] = []
    clusters = [[0], [1], [2]]

    async def fetch(_centroid, _user_id, workspace_id=None):
        await asyncio.sleep(0.01)
        return []

    events, applied = _group_fakes(monkeypatch, clusters, fetch)

    async def analyze(cluster_events, _candidates):
        if cluster_events[0]["id"] == "e1":
            raise RuntimeError("candidate lookup failed")
        await asyncio.sleep(0.01)
        finished.append(cluster_events[0]["id"])
        return [sync_pipeline.Assignment([0], "create", title="t")]

    monkeypatch.setattr(sync_pipeline.intent_analyzer, "analyze", analyze)

    with pytest.raises(RuntimeError):
        asyncio.run(sync_pipeline._process_group(events, "b1", set(), "u1"))
    # 다른 클러스터는 끝까지 돌았지만, 그룹이 실패하므로 아무것도 반영하지 않는다(예전과 같은 의미).
    assert sorted(finished) == ["e0", "e2"]
    assert applied == []


def test_process_batch_refreshes_two_sessions_at_a_time_and_isolates_failures(monkeypatch):
    gauge = _Concurrency()
    refreshed: list[str] = []
    warnings: list[str] = []

    async def fake_process_group(_group, _batch_id, touched, _user_id):
        touched.update({"s1", "s2", "s3", "s4"})
        return []

    async def refresh(session_id):
        await gauge.hold()
        if session_id == "s2":
            raise RuntimeError("summary boom")
        refreshed.append(session_id)

    async def noop(*_args, **_kwargs):
        return None

    async def disabled(_user_id):
        return False

    monkeypatch.setattr(sync_pipeline, "dedupe_events", lambda events: (events, []))
    monkeypatch.setattr(sync_pipeline, "group_by_time_gap", lambda events, **_k: [events])
    monkeypatch.setattr(sync_pipeline, "_process_group", fake_process_group)
    monkeypatch.setattr(sync_pipeline, "refresh_session_ai", refresh)
    monkeypatch.setattr(sync_pipeline, "is_auto_merge_enabled", disabled)
    _no_auto_folder(monkeypatch)
    monkeypatch.setattr(sync_pipeline, "_complete_batch", noop)
    monkeypatch.setattr(sync_pipeline.logger, "warning", lambda msg, *args: warnings.append(msg % args))

    asyncio.run(sync_pipeline._process_batch("b1", [{"id": "a"}], "u1"))

    assert gauge.peak == 2
    assert sorted(refreshed) == ["s1", "s3", "s4"]
    assert any("s2" in w and "summary boom" in w for w in warnings)


def test_process_group_analyzes_each_subject_of_a_large_subcluster_separately(monkeypatch):
    events, applied = _group_fakes(monkeypatch, [[0, 1, 2, 3, 4, 5]])
    seen: list[list[str]] = []

    async def split(cluster_events):
        assert [e["id"] for e in cluster_events] == ["e0", "e1", "e2", "e3", "e4", "e5"]
        return SplitResult([[0, 2, 4], [1, 3, 5]], "split@A.X-K2")

    async def analyze(cluster_events, _candidates):
        seen.append([e["id"] for e in cluster_events])
        return [sync_pipeline.Assignment(list(range(len(cluster_events))), "create", title="t")]

    monkeypatch.setattr(sync_pipeline, "split_by_subject", split)
    monkeypatch.setattr(sync_pipeline.intent_analyzer, "analyze", analyze)
    monkeypatch.setattr(sync_pipeline.settings, "subject_split_enabled", True)

    models = asyncio.run(sync_pipeline._process_group(events, "b1", set(), "u1"))

    assert sorted(seen) == [["e0", "e2", "e4"], ["e1", "e3", "e5"]]
    # 나누기 시도 결과와 모델이 배치 감사(sync_batches.model)로 간다.
    assert models == ["split@A.X-K2"]
    assert sync_pipeline._summarize_models({"A.X-K2": 2, "split@A.X-K2": 1}) == "A.X-K2:2,split@A.X-K2:1"
    assert applied == [["e0", "e2", "e4"], ["e1", "e3", "e5"]]


def test_subject_split_is_on_by_default():
    from app.config import Settings

    # S4 판정 합격으로 기본 켬(DecisionLog 2026-10-23).
    assert Settings.model_fields["subject_split_enabled"].default is True


def test_subject_split_off_leaves_subclusters_alone(monkeypatch):
    # 끄면 서브클러스터를 그대로 의도 분석에 넘긴다 — 대상 나누기 전 main과 같다.
    events, applied = _group_fakes(monkeypatch, [[0, 1, 2, 3, 4, 5], [6]])
    events.append({"id": "e6", "url": "https://example.com/6", "title": "t6", "workspace_id": None})
    seen: list[list[str]] = []

    split_calls: list[int] = []

    async def must_not_split(cluster_events):
        # 예외를 던지면 _split_clusters_by_subject가 삼키므로 호출 자체를 센다.
        split_calls.append(len(cluster_events))
        return SplitResult([list(range(len(cluster_events)))], "keep@A.X-K2")

    async def analyze(cluster_events, _candidates):
        seen.append([e["id"] for e in cluster_events])
        return [sync_pipeline.Assignment(list(range(len(cluster_events))), "create", title="t", model="A.X-K2")]

    monkeypatch.setattr(sync_pipeline, "split_by_subject", must_not_split)
    monkeypatch.setattr(sync_pipeline.intent_analyzer, "analyze", analyze)
    monkeypatch.setattr(sync_pipeline.settings, "subject_split_enabled", False)

    models = asyncio.run(sync_pipeline._process_group(events, "b1", set(), "u1"))

    assert split_calls == []
    assert models == ["A.X-K2", "A.X-K2"]  # 감사 기록도 의도 분석 모델만(대상 나누기 전과 같음)
    assert seen == [["e0", "e1", "e2", "e3", "e4", "e5"], ["e6"]]
    assert applied == seen


def test_subject_split_audit_counts_attempts_and_failures(monkeypatch):
    events, _applied = _group_fakes(monkeypatch, [[0, 1, 2, 3, 4, 5], [6, 7, 8, 9, 10, 11], [12, 13]])
    for i in range(12, 14):
        events.append({"id": f"e{i}", "url": f"https://example.com/{i}", "title": f"t{i}", "workspace_id": None})
    outcomes = {"e0": SplitResult([[0, 1, 2, 3, 4, 5]], "keep@A.X-K2"), "e12": SplitResult([[0, 1]], None)}

    async def split(cluster_events):
        if cluster_events[0]["id"] == "e6":
            raise RuntimeError("unexpected")  # split_by_subject 밖의 예외도 실패로 센다
        return outcomes[cluster_events[0]["id"]]

    async def analyze(cluster_events, _candidates):
        return [sync_pipeline.Assignment(list(range(len(cluster_events))), "create", title="t", model="A.X-K2")]

    monkeypatch.setattr(sync_pipeline, "split_by_subject", split)
    monkeypatch.setattr(sync_pipeline.intent_analyzer, "analyze", analyze)
    monkeypatch.setattr(sync_pipeline.settings, "subject_split_enabled", True)

    models = asyncio.run(sync_pipeline._process_group(events, "b1", set(), "u1"))

    assert sorted(models) == ["A.X-K2"] * 3 + ["keep@A.X-K2", "split_fail"]


def test_summarize_models_keeps_fallback_models_ahead_of_subject_split_labels():
    summary = sync_pipeline._summarize_models(
        {"split@A.X-K2": 9, "keep@A.X-K2": 7, "split_fail": 5, "A.X-K2": 12, "kt/midm-pro-fp8-kaic": 1,
         "exaone/depmkuykpfon9lg": 1}
    )
    assert summary.startswith("A.X-K2:12,")
    assert "kt:1" in summary and "exaone:1" in summary
    assert len(summary) <= 50


def _chain_scenario(monkeypatch, *, processed_ok: bool, waiting: list[int]) -> list[str]:
    """claim이 불린 배치 id 목록을 돌려준다. waiting은 후속 배치 확인 때마다 남은 pending 수."""
    claims: list[str] = []
    counter = iter(range(1, 100))

    async def fake_create_batch_row(_trigger_type):
        return f"batch-{next(counter)}"

    async def fake_claim(batch_id):
        claims.append(batch_id)
        return [{"id": f"e-{batch_id}"}], "u1"

    async def fake_process_batch(_batch_id, _claimed, _user_id):
        return processed_ok

    remaining = iter(waiting)

    async def fake_pending_outside(_ids):
        return next(remaining, 0)

    monkeypatch.setattr(sync_pipeline, "_create_batch_row", fake_create_batch_row)
    monkeypatch.setattr(sync_pipeline, "_claim_pending_events", fake_claim)
    monkeypatch.setattr(sync_pipeline, "_process_batch", fake_process_batch)
    monkeypatch.setattr(sync_pipeline, "_pending_outside", fake_pending_outside)

    async def scenario():
        await sync_pipeline.run_batch("manual")
        for _ in range(300):
            await asyncio.sleep(0.01)
            if not sync_pipeline.is_running() and not sync_pipeline._background_tasks:
                break

    asyncio.run(scenario())
    return claims


def test_batch_chains_when_another_stream_is_still_pending(monkeypatch):
    # 개인·팀 스트림이 한 업로드에 섞여 오면 첫 배치는 한 스트림만 가져간다 — 남은 스트림을 바로 이어 처리한다.
    assert _chain_scenario(monkeypatch, processed_ok=True, waiting=[3, 0]) == ["batch-1", "batch-2"]


def test_batch_chain_is_bounded(monkeypatch):
    assert len(_chain_scenario(monkeypatch, processed_ok=True, waiting=[1] * 10)) == 1 + sync_pipeline._MAX_CHAINED_BATCHES


def test_failed_batch_does_not_chain(monkeypatch):
    assert _chain_scenario(monkeypatch, processed_ok=False, waiting=[5]) == ["batch-1"]
