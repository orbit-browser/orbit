import asyncio

import httpx
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api import tab_actions
from app.schemas.tab_action import (
    OpenTabCandidate,
    TabActionResolveRequest,
    TabActionResolveResponse,
)
from app.services import tab_action_resolver


def candidate(
    candidate_id: str = "youtube",
    *,
    title: str = "YouTube",
    url: str = "https://www.youtube.com/watch?v=secret#section",
    active: bool = False,
) -> OpenTabCandidate:
    return OpenTabCandidate(id=candidate_id, title=title, url=url, active=active)


def test_candidate_passage_excludes_query_fragment_and_adds_known_site_context():
    passage = tab_action_resolver.build_candidate_passage(candidate())

    assert "YouTube" in passage
    assert "youtube.com" in passage
    assert "watch" in passage
    assert "동영상" in passage
    assert "secret" not in passage
    assert "section" not in passage


def test_cosine_rejects_invalid_dimensions():
    with pytest.raises(ValueError, match="dimensions"):
        tab_action_resolver.cosine_similarity([1.0], [1.0, 0.0])


def test_resolve_from_vectors_requires_navigation_intent_and_confident_match(monkeypatch):
    monkeypatch.setattr(tab_action_resolver.settings, "tab_action_intent_score_floor", 0.1)
    monkeypatch.setattr(tab_action_resolver.settings, "tab_action_intent_margin", 0.05)
    monkeypatch.setattr(tab_action_resolver.settings, "tab_action_match_score_floor", 0.2)
    monkeypatch.setattr(tab_action_resolver.settings, "tab_action_match_margin", 0.1)
    candidates = [
        candidate(),
        candidate("github", title="GitHub", url="https://github.com/orbit-browser/orbit"),
    ]
    # navigate prototype 2개는 query 방향, 나머지 intent와 두 번째 탭은 반대 방향이다.
    vectors = [[1.0, 0.0], [0.9, 0.1], [0.0, 1.0], [0.0, 1.0], [0.0, 1.0]]
    vectors += [[1.0, 0.0], [0.0, 1.0]]

    result = tab_action_resolver.resolve_from_vectors([1.0, 0.0], candidates, vectors)

    assert result.action == "navigate_tab"
    assert result.tab_id == "youtube"
    assert result.score == 1.0


def test_resolve_from_vectors_rejects_non_navigation_and_ambiguous_candidates(monkeypatch):
    monkeypatch.setattr(tab_action_resolver.settings, "tab_action_intent_score_floor", 0.1)
    monkeypatch.setattr(tab_action_resolver.settings, "tab_action_intent_margin", 0.05)
    monkeypatch.setattr(tab_action_resolver.settings, "tab_action_match_score_floor", 0.2)
    monkeypatch.setattr(tab_action_resolver.settings, "tab_action_match_margin", 0.1)
    candidates = [candidate(), candidate("same", title="YouTube duplicate")]

    non_navigation = [[0.0, 1.0], [0.0, 1.0], [1.0, 0.0], [1.0, 0.0], [1.0, 0.0]]
    non_navigation += [[1.0, 0.0], [0.0, 1.0]]
    assert tab_action_resolver.resolve_from_vectors(
        [1.0, 0.0], candidates, non_navigation
    ).action == "ask"

    ambiguous = [[1.0, 0.0], [1.0, 0.0], [0.0, 1.0], [0.0, 1.0], [0.0, 1.0]]
    ambiguous += [[1.0, 0.0], [0.999, 0.001]]
    result = tab_action_resolver.resolve_from_vectors([1.0, 0.0], candidates, ambiguous)
    assert result.action == "ask"
    assert result.tab_id is None
    assert [match.tab_id for match in result.candidates] == ["youtube", "same"]


def test_low_absolute_match_does_not_expose_unrelated_candidates(monkeypatch):
    monkeypatch.setattr(tab_action_resolver.settings, "tab_action_intent_score_floor", 0.1)
    monkeypatch.setattr(tab_action_resolver.settings, "tab_action_intent_margin", 0.05)
    monkeypatch.setattr(tab_action_resolver.settings, "tab_action_match_score_floor", 0.8)
    monkeypatch.setattr(tab_action_resolver.settings, "tab_action_match_margin", 0.1)
    candidates = [candidate(), candidate("github", title="GitHub")]
    vectors = [[1.0, 0.0], [1.0, 0.0], [0.0, 1.0], [0.0, 1.0], [0.0, 1.0]]
    vectors += [[0.7, 0.7], [0.69, 0.71]]

    result = tab_action_resolver.resolve_from_vectors([1.0, 0.0], candidates, vectors)

    assert result.action == "ask"
    assert result.candidates == []


def test_resolve_tab_action_batches_query_and_passages(monkeypatch):
    calls: dict[str, object] = {}

    async def fake_embed(text: str):
        calls["query"] = text
        return [1.0, 0.0]

    async def fake_embed_many(texts: list[str], *, model: str | None = None):
        calls["passages"] = texts
        calls["model"] = model
        return [[1.0, 0.0], [1.0, 0.0], [0.0, 1.0], [0.0, 1.0], [0.0, 1.0], [1.0, 0.0]]

    monkeypatch.setattr(tab_action_resolver, "embed", fake_embed)
    monkeypatch.setattr(tab_action_resolver, "embed_many", fake_embed_many)
    result = asyncio.run(tab_action_resolver.resolve_tab_action("영상으로 돌아가자", [candidate()]))

    assert result.action == "navigate_tab"
    assert calls["query"] == "영상으로 돌아가자"
    assert len(calls["passages"]) == 6
    assert calls["model"] == tab_action_resolver.settings.embedding_passage_model


def test_request_schema_rejects_more_than_one_hundred_candidates():
    with pytest.raises(ValidationError):
        TabActionResolveRequest(
            query="이동해줘",
            candidates=[candidate(str(index)) for index in range(101)],
        )


@pytest.mark.parametrize(
    ("error", "status"),
    [
        (httpx.ReadTimeout("timeout"), 504),
        (httpx.ConnectError("unavailable"), 503),
        (ValueError("bad response"), 502),
    ],
)
def test_api_maps_embedding_failures(monkeypatch, error, status):
    async def fail(_query, _candidates):
        raise error

    monkeypatch.setattr(tab_actions, "resolve_tab_action", fail)
    body = TabActionResolveRequest(query="영상으로 돌아가자", candidates=[candidate()])

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(tab_actions.resolve_open_tab_action(body))

    assert exc_info.value.status_code == status


def test_api_returns_resolver_result(monkeypatch):
    async def resolve(_query, _candidates):
        return TabActionResolveResponse(
            action="navigate_tab", reason="matched", tab_id="youtube", score=0.4, margin=0.2
        )

    monkeypatch.setattr(tab_actions, "resolve_tab_action", resolve)
    body = TabActionResolveRequest(query="영상으로 돌아가자", candidates=[candidate()])

    result = asyncio.run(tab_actions.resolve_open_tab_action(body))

    assert result.tab_id == "youtube"
