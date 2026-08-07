import asyncio

import httpx
import pytest
from fastapi import HTTPException

from app.api import assistant
from app.schemas.assistant import AssistantRouteRequest
from app.services import assistant_router


@pytest.mark.parametrize(
    ("query", "session_id", "expected"),
    [
        ("지금 보던 유튜브 화면으로 돌아가자", None, "navigate_tab"),
        ("리액트 공부한 세션 찾아줘", None, "find_sessions"),
        ("어느 세션에서 제주 맛집을 조사했지?", None, "find_sessions"),
        ("리액트 세션에서 Zustand 장점이 뭐였지?", None, "search_session"),
        ("결론을 알려줘", "session-1", "search_session"),
        ("탭 이동 기능이 어떻게 동작하는지 설명해줘", None, "search_memory"),
        ("유튜브 탭으로 이동이 안 되는 이유가 뭐야?", None, "search_memory"),
        ("리액트와 Vue를 비교해줘", None, "search_memory"),
    ],
)
def test_rule_intent(query, session_id, expected):
    assert assistant_router.rule_intent(query, session_id) == expected


def _prototype_vectors(
    navigate: list[float],
    find: list[float],
    session: list[float],
    memory: list[float],
) -> list[list[float]]:
    return [navigate, navigate, find, find, session, session, memory, memory]


def test_route_from_vectors_accepts_confident_navigation(monkeypatch):
    monkeypatch.setattr(assistant_router.settings, "assistant_route_navigation_floor", 0.1)
    monkeypatch.setattr(assistant_router.settings, "assistant_route_navigation_margin", 0.05)
    vectors = _prototype_vectors([1.0, 0.0], [0.0, 1.0], [-1.0, 0.0], [0.0, -1.0])

    result = assistant_router.route_from_vectors([1.0, 0.0], vectors)

    assert result.intent == "navigate_tab"
    assert result.reason == "semantic"


def test_route_from_vectors_falls_back_from_ambiguous_retrieval(monkeypatch):
    monkeypatch.setattr(assistant_router.settings, "assistant_route_retrieval_margin", 0.05)
    vectors = _prototype_vectors(
        [-1.0, 0.0],
        [1.0, 0.0],
        [0.999, 0.001],
        [0.998, 0.002],
    )

    result = assistant_router.route_from_vectors([1.0, 0.0], vectors)

    assert result.intent == "search_memory"
    assert result.reason == "fallback"


def test_route_assistant_batches_query_and_prototypes(monkeypatch):
    calls: dict[str, object] = {}

    async def fake_embed(text: str):
        calls["query"] = text
        return [0.0, 1.0]

    async def fake_embed_many(texts: list[str], *, model: str | None = None):
        calls["passages"] = texts
        calls["model"] = model
        return _prototype_vectors([1.0, 0.0], [0.0, 1.0], [-1.0, 0.0], [0.0, -1.0])

    monkeypatch.setattr(assistant_router, "embed", fake_embed)
    monkeypatch.setattr(assistant_router, "embed_many", fake_embed_many)

    result = asyncio.run(assistant_router.route_assistant("관련 자료 위치 알려줘"))

    assert result.intent == "find_sessions"
    assert calls["query"] == "관련 자료 위치 알려줘"
    assert len(calls["passages"]) == 8
    assert calls["model"] == assistant_router.settings.embedding_passage_model


@pytest.mark.parametrize(
    ("error", "status"),
    [
        (httpx.ReadTimeout("timeout"), 504),
        (httpx.ConnectError("unavailable"), 503),
        (ValueError("bad response"), 502),
    ],
)
def test_route_api_maps_embedding_failures(monkeypatch, error, status):
    async def fail(_query, _session_id):
        raise error

    monkeypatch.setattr(assistant, "route_assistant", fail)
    body = AssistantRouteRequest(query="전에 조사한 내용 알려줘")

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(assistant.resolve_assistant_route(body))

    assert exc_info.value.status_code == status
