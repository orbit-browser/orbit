import asyncio

import pytest

from app.ai import llm


async def _collect_stream():
    return [item async for item in llm.chat_completion_stream_with_meta("system", "user")]


def _stub_clients(monkeypatch):
    """클라이언트 생성을 대역으로 막는다.

    openai SDK는 빈 api_key로 AsyncOpenAI를 만들면 **생성 시점에** 예외를 던진다.
    _stream_provider만 대역 처리하면 인자로 넘길 클라이언트는 실제로 생성되므로,
    키가 없는 환경(CI·신규 클론)에서 스트림 로직과 무관하게 실패한다.
    """
    monkeypatch.setattr(llm, "_axk1_client", lambda: None)
    monkeypatch.setattr(llm, "_friendli_client", lambda: None)


def test_stream_falls_back_before_first_token(monkeypatch):
    async def no_throttle():
        return None

    async def fake_provider(_client, *, model, **_kwargs):
        if model == llm.settings.axk1_model:
            raise ValueError("primary failed")
        yield "fallback"

    _stub_clients(monkeypatch)
    monkeypatch.setattr(llm, "_throttle", no_throttle)
    monkeypatch.setattr(llm, "_stream_provider", fake_provider)

    assert asyncio.run(_collect_stream()) == [("fallback", llm._exaone_model_label())]


def test_stream_does_not_fallback_after_first_token(monkeypatch):
    async def no_throttle():
        return None

    async def interrupted_provider(_client, *, model, **_kwargs):
        yield "partial"
        raise RuntimeError(f"{model} disconnected")

    _stub_clients(monkeypatch)
    monkeypatch.setattr(llm, "_throttle", no_throttle)
    monkeypatch.setattr(llm, "_stream_provider", interrupted_provider)

    async def scenario():
        stream = llm.chat_completion_stream_with_meta("system", "user")
        first = await anext(stream)
        assert first == ("partial", llm.settings.axk1_model)
        with pytest.raises(llm.StreamInterruptedError):
            await anext(stream)

    asyncio.run(scenario())
