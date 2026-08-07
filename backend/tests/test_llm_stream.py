import asyncio

import pytest

from app.ai import llm


async def _collect_stream():
    return [item async for item in llm.chat_completion_stream_with_meta("system", "user")]


def test_stream_falls_back_before_first_token(monkeypatch):
    async def no_throttle():
        return None

    async def fake_provider(_client, *, model, **_kwargs):
        if model == llm.settings.axk1_model:
            raise ValueError("primary failed")
        yield "fallback"

    monkeypatch.setattr(llm, "_throttle", no_throttle)
    monkeypatch.setattr(llm, "_stream_provider", fake_provider)

    assert asyncio.run(_collect_stream()) == [("fallback", llm._exaone_model_label())]


def test_stream_does_not_fallback_after_first_token(monkeypatch):
    async def no_throttle():
        return None

    async def interrupted_provider(_client, *, model, **_kwargs):
        yield "partial"
        raise RuntimeError(f"{model} disconnected")

    monkeypatch.setattr(llm, "_throttle", no_throttle)
    monkeypatch.setattr(llm, "_stream_provider", interrupted_provider)

    async def scenario():
        stream = llm.chat_completion_stream_with_meta("system", "user")
        first = await anext(stream)
        assert first == ("partial", llm.settings.axk1_model)
        with pytest.raises(llm.StreamInterruptedError):
            await anext(stream)

    asyncio.run(scenario())
