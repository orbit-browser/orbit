import asyncio
from types import SimpleNamespace

from app.db import vector


def test_search_similar_passes_score_threshold(monkeypatch):
    captured: dict = {}

    class FakeClient:
        async def query_points(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(points=[SimpleNamespace(id="session-1")])

    monkeypatch.setattr(vector, "get_qdrant", lambda: FakeClient())
    monkeypatch.setattr(vector.settings, "search_score_threshold", 0.35)

    result = asyncio.run(vector.search_similar([0.1, 0.2], user_id="u1", limit=7))

    assert result == ["session-1"]
    assert captured["limit"] == 7
    assert captured["score_threshold"] == 0.35


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
    asyncio.run(reco._vector_scores("u9", ctx))
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
