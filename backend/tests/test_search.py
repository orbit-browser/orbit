import asyncio

import httpx
import pytest
from fastapi import HTTPException

from app.api import search


def run_search(monkeypatch, embed_result):
    async def fake_embed(_query):
        if isinstance(embed_result, Exception):
            raise embed_result
        return embed_result

    monkeypatch.setattr(search, "embed", fake_embed)
    return asyncio.run(search.search_sessions(q="query", limit=5, rerank=False, db=None))


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
