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
    assert created == ["user_id"]

    created.clear()
    monkeypatch.setattr(vector, "get_qdrant", lambda: _init_client({"user_id": object()}, created))
    asyncio.run(vector.init_collection())
    assert created == []
