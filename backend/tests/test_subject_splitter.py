"""큰 서브클러스터를 알아본 대상별로 다시 나누기(subject_splitter)."""

import asyncio
import json

import pytest

from app.services import subject_splitter


def _events(n: int) -> list[dict]:
    return [{"title": f"page {i}", "domain": "example.com", "active_duration_ms": 60000} for i in range(n)]


def _llm(monkeypatch, response):
    calls: list[str] = []

    async def fake(_system, user, **_kwargs):
        calls.append(user)
        if isinstance(response, Exception):
            raise response
        return response, "A.X-K2"

    monkeypatch.setattr(subject_splitter, "chat_completion_intent", fake)
    return calls


def _answer(groups: list[list[int]], relation: str | None = "independent") -> str:
    body: dict = {"groups": [{"subject": f"s{k}", "events": g} for k, g in enumerate(groups)]}
    if relation is not None:
        body["relation"] = relation
    return json.dumps(body)


def test_small_subcluster_is_not_asked(monkeypatch):
    calls = _llm(monkeypatch, _answer([[0, 1], [2, 3, 4]]))

    assert asyncio.run(subject_splitter.split_by_subject(_events(5))) == [[0, 1, 2, 3, 4]]
    assert calls == []


def test_independent_subjects_are_split_in_first_event_order(monkeypatch):
    calls = _llm(monkeypatch, _answer([[1, 3, 5], [0, 2, 4]]))

    assert asyncio.run(subject_splitter.split_by_subject(_events(6))) == [[0, 2, 4], [1, 3, 5]]
    assert len(calls) == 1 and "[5] page 5" in calls[0]


@pytest.mark.parametrize("relation", ["facets", "unsure", None, "<independent 또는 facets 또는 unsure>"])
def test_facets_or_unstated_relation_keeps_one_subject(monkeypatch, relation):
    # 한 목적의 세부 항목, 확실하지 않음, 형식 예시를 그대로 베낀 값은 나누지 않는다(보수적).
    _llm(monkeypatch, _answer([[0, 1, 2], [3, 4, 5]], relation))

    assert asyncio.run(subject_splitter.split_by_subject(_events(6))) == [[0, 1, 2, 3, 4, 5]]


@pytest.mark.parametrize(
    "raw",
    [
        _answer([[0, 1, 2], [3, 4]]),  # 빠진 이벤트
        _answer([[0, 1, 2], [2, 3, 4, 5]]),  # 겹친 이벤트
        _answer([[0, 1, 2], [3, 4, 9]]),  # 범위 밖
        "not json",
        json.dumps({"groups": []}),
    ],
)
def test_malformed_answer_keeps_the_subcluster_whole(monkeypatch, raw):
    _llm(monkeypatch, raw)

    assert asyncio.run(subject_splitter.split_by_subject(_events(6))) == [[0, 1, 2, 3, 4, 5]]


def test_call_failure_keeps_the_subcluster_whole(monkeypatch):
    _llm(monkeypatch, RuntimeError("provider down"))

    assert asyncio.run(subject_splitter.split_by_subject(_events(6))) == [[0, 1, 2, 3, 4, 5]]


def test_single_event_subject_joins_the_preceding_subject(monkeypatch):
    # 한 페이지만으로는 세션을 따로 만들 근거가 약하다.
    _llm(monkeypatch, _answer([[0, 1, 2], [3], [4, 5, 6]]))

    assert asyncio.run(subject_splitter.split_by_subject(_events(7))) == [[0, 1, 2, 3], [4, 5, 6]]
