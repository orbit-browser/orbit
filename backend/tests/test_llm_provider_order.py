"""LLM 공급자 순서 — 모든 역할 기본 A.X-K2, 대체 K-EXAONE (model-eval-v1 결정, 2026-10-22)."""

import asyncio
from types import SimpleNamespace

from openai import APIConnectionError

from app.ai import llm
from app.config import Settings


class _FakeOpenAI:
    """AsyncOpenAI 대역. 부른 모델 순서를 기록하고, fail_models의 모델은 연결 실패로 만든다."""

    calls: list[str] = []
    fail_models: set[str] = set()

    def __init__(self, **_kwargs):
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    async def _create(self, *, model, **_kwargs):
        _FakeOpenAI.calls.append(model)
        if model in _FakeOpenAI.fail_models:
            raise APIConnectionError(request=None)
        message = SimpleNamespace(content=f"from {model}")
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])


def _setup(monkeypatch, fail_models: set[str]):
    async def no_throttle():
        return None

    _FakeOpenAI.calls = []
    _FakeOpenAI.fail_models = fail_models
    monkeypatch.setattr(llm, "AsyncOpenAI", _FakeOpenAI)
    monkeypatch.setattr(llm, "_throttle", no_throttle)
    monkeypatch.setattr(llm.settings, "axk1_model", "A.X-K2")
    monkeypatch.setattr(llm.settings, "exaone_model", "K-EXAONE")


def test_default_chat_model_is_ax_k2():
    assert Settings.model_fields["axk1_model"].default == "A.X-K2"


def test_intent_uses_ax_k2_first(monkeypatch):
    _setup(monkeypatch, fail_models=set())

    content, model = asyncio.run(llm.chat_completion_intent("s", "u"))

    assert _FakeOpenAI.calls == ["A.X-K2"]
    assert (content, model) == ("from A.X-K2", "A.X-K2")


def test_intent_falls_back_to_exaone(monkeypatch):
    _setup(monkeypatch, fail_models={"A.X-K2"})

    content, model = asyncio.run(llm.chat_completion_intent("s", "u"))

    assert _FakeOpenAI.calls == ["A.X-K2", "K-EXAONE"]
    assert (content, model) == ("from K-EXAONE", "exaone/K-EXAONE")


def test_light_uses_ax_k2_first(monkeypatch):
    _setup(monkeypatch, fail_models=set())

    assert asyncio.run(llm.chat_completion_light("s", "u")) == "from A.X-K2"
    assert _FakeOpenAI.calls == ["A.X-K2"]


def test_light_falls_back_to_exaone(monkeypatch):
    _setup(monkeypatch, fail_models={"A.X-K2"})

    assert asyncio.run(llm.chat_completion_light("s", "u")) == "from K-EXAONE"
    assert _FakeOpenAI.calls == ["A.X-K2", "K-EXAONE"]


def test_summary_path_keeps_ax_k2_first(monkeypatch):
    _setup(monkeypatch, fail_models={"A.X-K2"})

    content, model = asyncio.run(llm.chat_completion_with_meta("s", "u"))

    assert _FakeOpenAI.calls == ["A.X-K2", "K-EXAONE"]
    assert model == "exaone/K-EXAONE"
