"""Ask 답변 스트림 — K-EXAONE 우선, 첫 토큰 전 실패 시 A.X-K2 (DecisionLog 2026-10-23)."""

import asyncio

import httpx
import pytest
from openai import APIStatusError, OpenAIError

from app.ai import llm

_NO_THINKING = {"chat_template_kwargs": {"enable_thinking": False}}


async def _collect_stream():
    return [item async for item in llm.chat_completion_stream_with_meta("system", "user")]


def _setup(monkeypatch, provider) -> list[dict]:
    """클라이언트 생성과 provider 스트림을 대역으로 바꾸고, provider 호출 인자를 기록한다.

    openai SDK는 빈 api_key로 AsyncOpenAI를 만들면 **생성 시점에** 예외를 던진다.
    _stream_provider만 대역 처리하면 인자로 넘길 클라이언트는 실제로 생성되므로,
    키가 없는 환경(CI·신규 클론)에서 스트림 로직과 무관하게 실패한다.
    """
    calls: list[dict] = []

    async def no_throttle():
        return None

    async def recording_provider(client, *, model, **kwargs):
        calls.append({"client": client, "model": model, **kwargs})
        async for text in provider(model):
            yield text

    monkeypatch.setattr(llm, "_ax_client", lambda: "ax")
    monkeypatch.setattr(llm, "_friendli_client", lambda: "friendli")
    monkeypatch.setattr(llm, "_throttle", no_throttle)
    monkeypatch.setattr(llm, "_stream_provider", recording_provider)
    monkeypatch.setattr(llm.settings, "axk1_model", "A.X-K2")
    monkeypatch.setattr(llm.settings, "exaone_model", "K-EXAONE")
    return calls


def test_stream_uses_exaone_first_without_thinking(monkeypatch):
    async def ok(model):
        yield f"from {model}"

    calls = _setup(monkeypatch, ok)

    assert asyncio.run(_collect_stream()) == [("from K-EXAONE", "exaone/K-EXAONE")]
    assert [(c["client"], c["model"]) for c in calls] == [("friendli", "K-EXAONE")]
    assert calls[0]["extra_body"] == _NO_THINKING


def test_stream_falls_back_to_ax_before_first_token(monkeypatch):
    async def exaone_fails(model):
        if model == "K-EXAONE":
            raise ValueError("primary failed")
        yield f"from {model}"

    calls = _setup(monkeypatch, exaone_fails)

    assert asyncio.run(_collect_stream()) == [("from A.X-K2", "A.X-K2")]
    assert [(c["client"], c["model"]) for c in calls] == [("friendli", "K-EXAONE"), ("ax", "A.X-K2")]
    assert calls[1].get("extra_body") is None


def test_stream_falls_back_to_ax_on_empty_exaone_stream(monkeypatch):
    async def exaone_empty(model):
        if model != "K-EXAONE":
            yield f"from {model}"

    _setup(monkeypatch, exaone_empty)

    assert asyncio.run(_collect_stream()) == [("from A.X-K2", "A.X-K2")]


def test_stream_falls_back_when_exaone_client_cannot_be_created(monkeypatch):
    async def ok(model):
        yield f"from {model}"

    _setup(monkeypatch, ok)

    def missing_key():
        raise OpenAIError("missing api key")

    monkeypatch.setattr(llm, "_friendli_client", missing_key)

    assert asyncio.run(_collect_stream()) == [("from A.X-K2", "A.X-K2")]


def test_stream_does_not_fallback_after_first_token(monkeypatch):
    async def interrupted(model):
        yield "partial"
        raise RuntimeError(f"{model} disconnected")

    calls = _setup(monkeypatch, interrupted)

    async def scenario():
        stream = llm.chat_completion_stream_with_meta("system", "user")
        first = await anext(stream)
        assert first == ("partial", "exaone/K-EXAONE")
        with pytest.raises(llm.StreamInterruptedError) as info:
            await anext(stream)
        assert info.value.model == "exaone/K-EXAONE"

    asyncio.run(scenario())
    assert [c["model"] for c in calls] == ["K-EXAONE"]


def test_stream_raises_interrupted_when_ax_fallback_breaks_after_first_token(monkeypatch):
    async def both_break(model):
        if model == "K-EXAONE":
            raise ValueError("primary failed")
        yield "partial"
        raise RuntimeError("disconnected")

    _setup(monkeypatch, both_break)

    async def scenario():
        stream = llm.chat_completion_stream_with_meta("system", "user")
        assert await anext(stream) == ("partial", "A.X-K2")
        with pytest.raises(llm.StreamInterruptedError) as info:
            await anext(stream)
        assert info.value.model == "A.X-K2"

    asyncio.run(scenario())


@pytest.mark.parametrize("status", [401, 403])
def test_stream_falls_back_when_primary_key_is_rejected(monkeypatch, status):
    async def rejected(model):
        if model == "K-EXAONE":
            response = httpx.Response(status, request=httpx.Request("POST", "https://llm.test"))
            raise APIStatusError("rejected", response=response, body=None)
        yield f"from {model}"

    _setup(monkeypatch, rejected)

    assert asyncio.run(_collect_stream()) == [("from A.X-K2", "A.X-K2")]


def test_stream_keeps_client_errors_loud(monkeypatch):
    async def bad_request(model):
        response = httpx.Response(400, request=httpx.Request("POST", "https://llm.test"))
        raise APIStatusError("bad request", response=response, body=None)
        yield ""  # pragma: no cover - async generator 표시

    calls = _setup(monkeypatch, bad_request)

    with pytest.raises(APIStatusError):
        asyncio.run(_collect_stream())
    assert [c["model"] for c in calls] == ["K-EXAONE"]


def test_should_fallback_keeps_client_errors_loud():
    assert llm._should_fallback(401)
    assert llm._should_fallback(502)
    assert not llm._should_fallback(400)
    assert not llm._should_fallback(422)
