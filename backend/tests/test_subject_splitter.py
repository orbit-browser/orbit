"""큰 서브클러스터를 알아본 대상별로 다시 나누기(subject_splitter)."""

import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest
from openai import APIConnectionError, RateLimitError

from app.ai import llm

from app.services import subject_splitter


def _events(n: int) -> list[dict]:
    return [{"title": f"page {i}", "domain": "example.com", "active_duration_ms": 60000} for i in range(n)]


def _groups_of(events: list[dict]) -> list[list[int]]:
    return asyncio.run(subject_splitter.split_by_subject(events)).groups


def _llm(monkeypatch, response):
    calls: list[str] = []

    async def fake(_system, user, **_kwargs):
        calls.append(user)
        if isinstance(response, Exception):
            raise response
        return response, "A.X-K2"

    monkeypatch.setattr(subject_splitter, "chat_completion_ax_only", fake)
    return calls


def _answer(groups: list[list[int]], relation: str | None = "independent") -> str:
    body: dict = {"groups": [{"subject": f"s{k}", "events": g} for k, g in enumerate(groups)]}
    if relation is not None:
        body["relation"] = relation
    return json.dumps(body)


def test_small_subcluster_is_not_asked(monkeypatch):
    calls = _llm(monkeypatch, _answer([[0, 1], [2, 3, 4]]))

    assert _groups_of(_events(5)) == [[0, 1, 2, 3, 4]]
    assert calls == []


def test_independent_subjects_are_split_in_first_event_order(monkeypatch):
    calls = _llm(monkeypatch, _answer([[1, 3, 5], [0, 2, 4]]))

    assert _groups_of(_events(6)) == [[0, 2, 4], [1, 3, 5]]
    assert len(calls) == 1 and "[5] page 5" in calls[0]


@pytest.mark.parametrize("relation", ["facets", "unsure", None, "<independent 또는 facets 또는 unsure>"])
def test_facets_or_unstated_relation_keeps_one_subject(monkeypatch, relation):
    # 한 목적의 세부 항목, 확실하지 않음, 형식 예시를 그대로 베낀 값은 나누지 않는다(보수적).
    _llm(monkeypatch, _answer([[0, 1, 2], [3, 4, 5]], relation))

    assert _groups_of(_events(6)) == [[0, 1, 2, 3, 4, 5]]


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

    assert _groups_of(_events(6)) == [[0, 1, 2, 3, 4, 5]]


def test_call_failure_keeps_the_subcluster_whole(monkeypatch):
    _llm(monkeypatch, RuntimeError("provider down"))

    assert _groups_of(_events(6)) == [[0, 1, 2, 3, 4, 5]]


def test_single_event_subject_joins_the_preceding_subject(monkeypatch):
    # 한 페이지만으로는 세션을 따로 만들 근거가 약하다.
    _llm(monkeypatch, _answer([[0, 1, 2], [3], [4, 5, 6]]))

    assert _groups_of(_events(7)) == [[0, 1, 2, 3], [4, 5, 6]]


class _FakeOpenAI:
    """AsyncOpenAI 대역. 만들어진 클라이언트의 base_url과 호출한 모델을 기록한다."""

    created: list[str] = []
    clients: list[dict] = []
    models: list[str] = []
    behavior = "ok"

    def __init__(self, **kwargs):
        _FakeOpenAI.created.append(kwargs["base_url"])
        _FakeOpenAI.clients.append(kwargs)
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    async def _create(self, *, model, **_kwargs):
        _FakeOpenAI.models.append(model)
        request = httpx.Request("POST", "https://llm.test")
        if _FakeOpenAI.behavior == "connection":
            raise APIConnectionError(request=request)
        if _FakeOpenAI.behavior == "rate_limit":
            raise RateLimitError("429", response=httpx.Response(429, request=request), body=None)
        content = "  " if _FakeOpenAI.behavior == "empty" else _answer([[0, 1, 2], [3, 4, 5]])
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


def _real_llm(monkeypatch, behavior):
    async def no_throttle(*_args):
        return None

    _FakeOpenAI.created, _FakeOpenAI.clients, _FakeOpenAI.models, _FakeOpenAI.behavior = [], [], [], behavior
    monkeypatch.setattr(llm, "AsyncOpenAI", _FakeOpenAI)
    monkeypatch.setattr(llm, "_throttle", no_throttle)
    for name, value in [
        ("axk1_api_key", "k"), ("axk1_base_url", "https://ax.invalid/v1"), ("axk1_model", "A.X-K2"),
        ("kt_api_key", "k"), ("friendli_api_key", "k"),
    ]:
        monkeypatch.setattr(llm.settings, name, value)


def test_subject_split_asks_ax_k2(monkeypatch):
    _real_llm(monkeypatch, "ok")

    assert _groups_of(_events(6)) == [[0, 1, 2], [3, 4, 5]]
    assert _FakeOpenAI.models == ["A.X-K2"]
    assert _FakeOpenAI.created == ["https://ax.invalid/v1"]


@pytest.mark.parametrize("behavior", ["connection", "rate_limit", "empty"])
def test_subject_split_has_no_fallback_provider(monkeypatch, behavior):
    # 대상 나누기는 K2 전용이다. K2가 못 하면 KT·EXAONE에 넘기지 않고 나누지 않는다(S3 판정 2026-10-23).
    _real_llm(monkeypatch, behavior)

    assert _groups_of(_events(6)) == [[0, 1, 2, 3, 4, 5]]
    assert _FakeOpenAI.models == ["A.X-K2"]
    assert _FakeOpenAI.created == ["https://ax.invalid/v1"]


def test_subject_split_client_has_no_retries_and_short_timeout(monkeypatch):
    # SDK 기본 재시도(2회)가 살아 있으면 실패한 나누기가 배치를 36초까지 붙잡는다.
    _real_llm(monkeypatch, "ok")

    asyncio.run(subject_splitter.split_by_subject(_events(6)))

    assert _FakeOpenAI.clients[0]["max_retries"] == 0
    assert _FakeOpenAI.clients[0]["timeout"] == 12.0


@pytest.mark.parametrize(
    "behavior,n,audit",
    [("ok", 6, "split@A.X-K2"), ("connection", 6, "split_fail"), ("empty", 6, "split_fail"), ("ok", 5, None)],
)
def test_split_result_carries_an_audit_label(monkeypatch, behavior, n, audit):
    _real_llm(monkeypatch, behavior)

    assert asyncio.run(subject_splitter.split_by_subject(_events(n))).audit == audit


def test_split_result_marks_kept_subclusters(monkeypatch):
    _llm(monkeypatch, _answer([[0, 1, 2], [3, 4, 5]], "facets"))

    assert asyncio.run(subject_splitter.split_by_subject(_events(6))).audit == "keep@A.X-K2"
