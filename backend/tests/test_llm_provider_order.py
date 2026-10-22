"""LLM 공급자 순서 — 모든 역할 기본 A.X-K2, 대체 K-EXAONE (model-eval-v1 결정, 2026-10-22)."""

import asyncio
from types import SimpleNamespace

import httpx
import pytest
from openai import APIConnectionError, AuthenticationError, OpenAIError, RateLimitError

from app.ai import llm
from app.config import Settings

_NO_THINKING = {"chat_template_kwargs": {"enable_thinking": False}}


def _status_error(cls, code: int):
    request = httpx.Request("POST", "https://example.invalid/v1/chat/completions")
    return cls("stub", response=httpx.Response(code, request=request), body=None)


class _FakeOpenAI:
    """AsyncOpenAI 대역. 클라이언트 설정과 호출 인자를 기록하고, 모델별 실패를 흉내 낸다.

    failures: 모델 → "connection" | "rate_limit" | "auth" | "empty". 빈 api_key로 만들면 실제 SDK처럼
    생성자에서 OpenAIError를 던진다.
    """

    clients: list[dict] = []
    calls: list[dict] = []
    failures: dict[str, str] = {}

    def __init__(self, **kwargs):
        if not kwargs.get("api_key"):
            raise OpenAIError("missing api key")
        _FakeOpenAI.clients.append(kwargs)
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    async def _create(self, *, model, **kwargs):
        _FakeOpenAI.calls.append({"model": model, **kwargs})
        failure = _FakeOpenAI.failures.get(model)
        if failure == "connection":
            raise APIConnectionError(request=None)
        if failure == "rate_limit":
            raise _status_error(RateLimitError, 429)
        if failure == "auth":
            raise _status_error(AuthenticationError, 401)
        content = "  " if failure == "empty" else f"from {model}"
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


def _setup(monkeypatch, failures: dict[str, str] | None = None, axk1_key: str = "test-key"):
    async def no_throttle():
        return None

    _FakeOpenAI.clients = []
    _FakeOpenAI.calls = []
    _FakeOpenAI.failures = failures or {}
    monkeypatch.setattr(llm, "AsyncOpenAI", _FakeOpenAI)
    monkeypatch.setattr(llm, "_throttle", no_throttle)
    monkeypatch.setattr(llm.settings, "axk1_model", "A.X-K2")
    monkeypatch.setattr(llm.settings, "exaone_model", "K-EXAONE")
    monkeypatch.setattr(llm.settings, "axk1_api_key", axk1_key)
    monkeypatch.setattr(llm.settings, "friendli_api_key", "test-key")


def _models() -> list[str]:
    return [call["model"] for call in _FakeOpenAI.calls]


def test_default_chat_model_is_ax_k2():
    assert Settings.model_fields["axk1_model"].default == "A.X-K2"


# ── 의도 분석 ──────────────────────────────────────────────────────────────


def test_intent_uses_ax_k2_first_with_short_timeout_and_no_retries(monkeypatch):
    _setup(monkeypatch)

    content, model = asyncio.run(llm.chat_completion_intent("s", "u"))

    assert _models() == ["A.X-K2"]
    assert (content, model) == ("from A.X-K2", "A.X-K2")
    assert _FakeOpenAI.clients[0]["timeout"] == 12.0
    assert _FakeOpenAI.clients[0]["max_retries"] == 0
    assert "extra_body" not in _FakeOpenAI.calls[0]


@pytest.mark.parametrize("failure", ["connection", "rate_limit", "empty"])
def test_intent_falls_back_to_exaone_without_thinking(monkeypatch, failure):
    _setup(monkeypatch, {"A.X-K2": failure})

    content, model = asyncio.run(llm.chat_completion_intent("s", "u"))

    assert _models() == ["A.X-K2", "K-EXAONE"]
    assert (content, model) == ("from K-EXAONE", "exaone/K-EXAONE")
    assert _FakeOpenAI.calls[1]["extra_body"] == _NO_THINKING


def test_intent_raises_on_auth_error_without_fallback(monkeypatch):
    # 401은 설정 오류다. EXAONE으로 가리지 않고 올려서 analyze가 그룹을 hold하게 한다.
    _setup(monkeypatch, {"A.X-K2": "auth"})

    with pytest.raises(AuthenticationError):
        asyncio.run(llm.chat_completion_intent("s", "u"))
    assert _models() == ["A.X-K2"]


def test_intent_falls_back_when_ax_client_cannot_be_created(monkeypatch):
    _setup(monkeypatch, axk1_key="")

    content, model = asyncio.run(llm.chat_completion_intent("s", "u"))

    assert _models() == ["K-EXAONE"]
    assert model == "exaone/K-EXAONE"
    assert _FakeOpenAI.calls[0]["extra_body"] == _NO_THINKING


# ── 탭 묶기 ────────────────────────────────────────────────────────────────


def test_light_uses_ax_k2_first(monkeypatch):
    _setup(monkeypatch)

    assert asyncio.run(llm.chat_completion_light("s", "u")) == "from A.X-K2"
    assert _models() == ["A.X-K2"]


@pytest.mark.parametrize("failure", ["connection", "empty"])
def test_light_falls_back_to_exaone_without_thinking(monkeypatch, failure):
    _setup(monkeypatch, {"A.X-K2": failure})

    assert asyncio.run(llm.chat_completion_light("s", "u")) == "from K-EXAONE"
    assert _models() == ["A.X-K2", "K-EXAONE"]
    assert _FakeOpenAI.calls[1]["extra_body"] == _NO_THINKING


def test_light_falls_back_when_ax_client_cannot_be_created(monkeypatch):
    _setup(monkeypatch, axk1_key="")

    assert asyncio.run(llm.chat_completion_light("s", "u")) == "from K-EXAONE"
    assert _models() == ["K-EXAONE"]


# ── 요약 경로 ──────────────────────────────────────────────────────────────


def test_summary_path_keeps_ax_k2_first(monkeypatch):
    _setup(monkeypatch, {"A.X-K2": "connection"})

    content, model = asyncio.run(llm.chat_completion_with_meta("s", "u"))

    assert _models() == ["A.X-K2", "K-EXAONE"]
    assert model == "exaone/K-EXAONE"
