import asyncio
from types import SimpleNamespace

import pytest
from qdrant_client.models import FieldCondition, IsEmptyCondition, MatchValue, SearchParams

from app.db import vector


def _owner_of(query_filter) -> str:
    (condition,) = query_filter.must
    assert isinstance(condition, FieldCondition)
    assert condition.key == "user_id"
    assert isinstance(condition.match, MatchValue)
    return condition.match.value


def test_search_similar_passes_score_threshold(monkeypatch):
    captured: dict = {}

    class FakeClient:
        async def query_points(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(points=[SimpleNamespace(id="session-1")])

    monkeypatch.setattr(vector, "get_qdrant", lambda: FakeClient())
    monkeypatch.setattr(vector.settings, "search_score_threshold", 0.35)

    result = asyncio.run(vector.search_similar([0.1, 0.2], limit=7, user_id="u1"))

    assert result == ["session-1"]
    assert captured["limit"] == 7
    assert captured["score_threshold"] == 0.35
    assert _owner_of(captured["query_filter"]) == "u1"


def test_search_similar_with_scores_filters_by_owner(monkeypatch):
    """다른 사용자 포인트가 top-k를 채우지 않도록 Qdrant 단계에서 소유자로 좁힌다."""
    captured: dict = {}

    class FakeClient:
        async def query_points(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(points=[SimpleNamespace(id="session-1", score=0.8)])

    monkeypatch.setattr(vector, "get_qdrant", lambda: FakeClient())

    result = asyncio.run(
        vector.search_similar_with_scores([0.1], limit=3, score_threshold=0.5, user_id="u2")
    )

    assert result == [("session-1", 0.8)]
    assert captured["score_threshold"] == 0.5
    assert _owner_of(captured["query_filter"]) == "u2"


@pytest.mark.parametrize("search,scope", [
    (vector.search_similar, {}),
    (vector.search_similar, {"session_ids": ["session-1"]}),
    (vector.search_similar_with_scores, {}),
])
def test_search_passes_recall_search_params(monkeypatch, search, scope):
    captured: dict = {}

    class FakeClient:
        async def query_points(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(points=[])

    monkeypatch.setattr(vector, "get_qdrant", lambda: FakeClient())

    assert asyncio.run(search([0.1], user_id="u1", **scope)) == []

    # The 10,000-session regression loses three answers at ef=64/128.
    assert captured["search_params"] == SearchParams(hnsw_ef=256)


@pytest.mark.parametrize("search", [
    vector.search_similar,
    vector.search_similar_with_scores,
])
def test_search_propagates_qdrant_failure(monkeypatch, search):
    class FakeClient:
        async def query_points(self, **kwargs):
            raise RuntimeError("Qdrant unavailable")

    monkeypatch.setattr(vector, "get_qdrant", lambda: FakeClient())

    with pytest.raises(RuntimeError, match="Qdrant unavailable"):
        asyncio.run(search([0.1], user_id="u1"))


def test_point_ids_missing_owner_pages_until_offset_ends(monkeypatch):
    calls: list = []
    pages = {
        None: ([SimpleNamespace(id="a"), SimpleNamespace(id="b")], "next"),
        "next": ([SimpleNamespace(id="c")], None),
    }

    class FakeClient:
        async def scroll(self, **kwargs):
            calls.append(kwargs)
            return pages[kwargs["offset"]]

    monkeypatch.setattr(vector, "get_qdrant", lambda: FakeClient())

    assert asyncio.run(vector.point_ids_missing_owner()) == ["a", "b", "c"]
    assert [call["offset"] for call in calls] == [None, "next"]
    (condition,) = calls[0]["scroll_filter"].must
    assert isinstance(condition, IsEmptyCondition)
    assert condition.is_empty.key == "user_id"


def _init_client(payload_schema: dict, created: list):
    class FakeClient:
        async def get_collections(self):
            return SimpleNamespace(collections=[SimpleNamespace(name=vector.COLLECTION)])

        async def get_collection(self, _name):
            return SimpleNamespace(payload_schema=payload_schema)

        async def create_payload_index(self, **kwargs):
            created.append(kwargs["field_name"])

    return FakeClient()


def test_init_collection_creates_owner_index_once(monkeypatch):
    created: list = []
    monkeypatch.setattr(vector, "get_qdrant", lambda: _init_client({}, created))
    asyncio.run(vector.init_collection())
    assert created == ["user_id", "collect_workspace_id"]

    created.clear()
    monkeypatch.setattr(
        vector,
        "get_qdrant",
        lambda: _init_client({"user_id": object(), "collect_workspace_id": object()}, created),
    )
    asyncio.run(vector.init_collection())
    assert created == []


def test_search_functions_send_user_filter(monkeypatch):
    calls: list[dict] = []

    class FakeClient:
        async def query_points(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(points=[SimpleNamespace(id="s1", score=0.9)])

    monkeypatch.setattr(vector, "get_qdrant", lambda: FakeClient())

    assert asyncio.run(vector.search_similar([0.1], user_id="u1")) == ["s1"]
    assert asyncio.run(
        vector.search_similar_with_scores([0.1], user_id="u2", score_threshold=0.5)
    ) == [("s1", 0.9)]

    for call, uid in zip(calls, ["u1", "u2"]):
        cond = call["query_filter"].must[0]
        assert cond.key == "user_id" and cond.match.value == uid
    assert calls[1]["score_threshold"] == 0.5


def test_score_sessions_limits_to_ids_and_owner_without_threshold(monkeypatch):
    captured: dict = {}

    class FakeClient:
        async def query_points(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(points=[SimpleNamespace(id="s1", score=0.21)])

    monkeypatch.setattr(vector, "get_qdrant", lambda: FakeClient())

    assert asyncio.run(vector.score_sessions([0.1], ["s1", "s2"], user_id="u1")) == {"s1": 0.21}
    owner, ids = captured["query_filter"].must
    assert owner.key == "user_id" and owner.match.value == "u1"
    assert ids.has_id == ["s1", "s2"]
    assert captured["limit"] == 2
    assert "score_threshold" not in captured
    assert asyncio.run(vector.score_sessions([0.1], [], user_id="u1")) == {}


def test_get_vectors_returns_found_points_and_raises_on_error(monkeypatch):
    class FakeClient:
        async def retrieve(self, **kwargs):
            assert kwargs["ids"] == ["s1", "s2"] and kwargs["with_vectors"] is True
            return [SimpleNamespace(id="s1", vector=[0.1]), SimpleNamespace(id="s2", vector={"named": [0.2]})]

    monkeypatch.setattr(vector, "get_qdrant", lambda: FakeClient())
    assert asyncio.run(vector.get_vectors(["s1", "s2"])) == {"s1": [0.1]}
    assert asyncio.run(vector.get_vectors([])) == {}

    class Down:
        async def retrieve(self, **_kwargs):
            raise RuntimeError("qdrant down")

    monkeypatch.setattr(vector, "get_qdrant", lambda: Down())
    import pytest

    with pytest.raises(RuntimeError):
        asyncio.run(vector.get_vectors(["s1"]))


def test_score_sessions_many_batches_owner_and_id_filter(monkeypatch):
    captured: dict = {}

    class FakeClient:
        async def query_batch_points(self, **kwargs):
            captured.update(kwargs)
            return [
                SimpleNamespace(points=[SimpleNamespace(id="m1", score=0.5)]),
                SimpleNamespace(points=[SimpleNamespace(id="m2", score=0.3)]),
            ]

    monkeypatch.setattr(vector, "get_qdrant", lambda: FakeClient())
    result = asyncio.run(vector.score_sessions_many({"a": [0.1], "b": [0.2]}, ["m1", "m2"], user_id="u1"))

    assert result == {"a": {"m1": 0.5}, "b": {"m2": 0.3}}
    first = captured["requests"][0]
    owner, ids = first.filter.must
    assert owner.key == "user_id" and owner.match.value == "u1"
    assert ids.has_id == ["m1", "m2"] and first.limit == 2
    assert asyncio.run(vector.score_sessions_many({"a": [0.1]}, [], user_id="u1")) == {"a": {}}


def test_search_requires_user_id():
    import pytest

    with pytest.raises(TypeError):
        asyncio.run(vector.search_similar([0.1]))


class _FakeDBCtx:
    def __init__(self, owners):
        self.owners = owners

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def execute(self, _stmt):
        return SimpleNamespace(all=lambda: list(self.owners.items()))


def _backfill_client(pages):
    state = SimpleNamespace(set_calls=[], deleted=[], pages=list(pages))

    class FakeClient:
        async def scroll(self, **_kwargs):
            return state.pages.pop(0)

        async def set_payload(self, **kwargs):
            state.set_calls.append((kwargs["points"], kwargs["payload"]))

        async def delete(self, **kwargs):
            state.deleted.extend(kwargs["points_selector"].points)

    return state, FakeClient()


def test_backfill_sets_payload_and_deletes_orphans(monkeypatch):
    from app.db import session as db_session

    state, client = _backfill_client([
        ([SimpleNamespace(id="a"), SimpleNamespace(id="orphan")], "next"),
        ([SimpleNamespace(id="b")], None),
    ])
    monkeypatch.setattr(vector, "get_qdrant", lambda: client)
    monkeypatch.setattr(db_session, "AsyncSessionLocal", lambda: _FakeDBCtx({"a": "u1", "b": "u2"}))

    asyncio.run(vector.backfill_user_ids())

    assert state.set_calls == [(["a"], {"user_id": "u1"}), (["b"], {"user_id": "u2"})]
    assert state.deleted == ["orphan"]


def test_backfill_groups_payload_updates_by_owner(monkeypatch):
    from app.db import session as db_session

    state, client = _backfill_client([
        ([SimpleNamespace(id="a"), SimpleNamespace(id="b"), SimpleNamespace(id="c")], None),
    ])
    monkeypatch.setattr(vector, "get_qdrant", lambda: client)
    monkeypatch.setattr(db_session, "AsyncSessionLocal", lambda: _FakeDBCtx({"a": "u1", "b": "u2", "c": "u1"}))

    asyncio.run(vector.backfill_user_ids())

    assert state.set_calls == [(["a", "c"], {"user_id": "u1"}), (["b"], {"user_id": "u2"})]


def test_backfill_swallows_errors(monkeypatch):
    class Boom:
        async def scroll(self, **_kwargs):
            raise RuntimeError("qdrant down")

    monkeypatch.setattr(vector, "get_qdrant", lambda: Boom())
    asyncio.run(vector.backfill_user_ids())


def test_init_collection_tolerates_existing_index(monkeypatch):
    created: list[dict] = []

    class FakeClient:
        async def get_collections(self):
            return SimpleNamespace(collections=[SimpleNamespace(name=vector.COLLECTION)])

        async def get_collection(self, _name):
            # 스키마 조회와 인덱스 생성 사이에 다른 프로세스가 먼저 만든 경우
            return SimpleNamespace(payload_schema={})

        async def create_payload_index(self, **kwargs):
            created.append(kwargs)
            raise RuntimeError("Index already exists")

    monkeypatch.setattr(vector, "get_qdrant", lambda: FakeClient())
    asyncio.run(vector.init_collection())
    assert created[0]["field_name"] == "user_id"


def test_recommender_and_merge_suggester_pass_user_id(monkeypatch):
    from app.services import merge_suggester
    from app.services.recommender import service as reco

    seen: list[str] = []

    async def fake_embed(_t):
        return [0.1]

    async def fake_search(_v, *, user_id, **_k):
        seen.append(user_id)
        return []

    monkeypatch.setattr(reco, "embed", fake_embed)
    monkeypatch.setattr(reco, "search_similar_with_scores", fake_search)
    ctx = SimpleNamespace(query="q", current_title=None, current_url=None)
    asyncio.run(reco._vector_scores(ctx, "u9"))
    assert seen == ["u9"]

    async def fake_get_vector(_sid):
        return [0.1]

    sessions = [SimpleNamespace(id="s1")]

    class _DB:
        async def execute(self, _stmt):
            return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: sessions))

    monkeypatch.setattr(merge_suggester, "_to_meta", lambda s: s)
    monkeypatch.setattr(merge_suggester, "get_vector", fake_get_vector)
    monkeypatch.setattr(merge_suggester, "search_similar_with_scores", fake_search)
    seen.clear()
    asyncio.run(merge_suggester.find_merge_suggestions(_DB(), "u8"))
    assert seen == ["u8"]


def test_scored_search_team_scope_finds_teammates_shared_sessions(monkeypatch):
    """Ask 후보 검색(점수 포함)도 팀 범위에서는 공유 id로만 좁힌다. user 필터를 같이 걸면 다른 멤버가
    공유한 세션이 빠진다. 개인 범위는 user 필터 그대로다."""
    calls: list[dict] = []

    class FakeClient:
        async def query_points(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(points=[SimpleNamespace(id="teammate-shared", score=0.7)])

    monkeypatch.setattr(vector, "get_qdrant", lambda: FakeClient())

    team = asyncio.run(
        vector.search_similar_with_scores([0.1], user_id="viewer", session_ids=["teammate-shared"])
    )
    personal = asyncio.run(vector.search_similar_with_scores([0.1], user_id="viewer"))

    assert team == [("teammate-shared", 0.7)]
    (condition,) = calls[0]["query_filter"].must
    assert condition.has_id == ["teammate-shared"]
    assert _owner_of(calls[1]["query_filter"]) == "viewer"
    assert personal == [("teammate-shared", 0.7)]
    assert asyncio.run(vector.search_similar_with_scores([0.1], user_id="viewer", session_ids=[])) == []
    assert len(calls) == 2
