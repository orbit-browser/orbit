"""공급자별 호출 간격 리미터 — A.X 0.25초, EXAONE·KT 0.5초, 429면 그 공급자만 늦춘다(CTO 2026-10-23)."""

import asyncio
from types import SimpleNamespace

import httpx
import pytest
from openai import RateLimitError

from app.ai import llm


class _Clock:
    """time.monotonic·asyncio.sleep 대역. sleep은 실제로 기다리지 않고 시계를 민다."""

    def __init__(self):
        self.now = 1000.0
        self.sleeps: list[float] = []

    def monotonic(self) -> float:
        return self.now

    async def sleep(self, seconds: float) -> None:
        self.sleeps.append(round(seconds, 3))
        self.now += seconds


@pytest.fixture
def clock(monkeypatch):
    fake = _Clock()
    monkeypatch.setattr(llm.time, "monotonic", fake.monotonic)
    monkeypatch.setattr(llm.asyncio, "sleep", fake.sleep)
    monkeypatch.setattr(llm, "_rate_locks", {})
    monkeypatch.setattr(llm, "_next_call_at", {})
    return fake


def test_intervals_are_per_provider(clock):
    async def scenario():
        await llm._throttle("ax")
        await llm._throttle("ax")  # A.X 두 번째는 0.25초 기다린다
        await llm._throttle("exaone")  # 다른 공급자는 A.X 뒤에 줄 서지 않는다
        await llm._throttle("kt")
        await llm._throttle("exaone")  # EXAONE 두 번째는 첫 EXAONE 뒤 0.5초를 채운다

    asyncio.run(scenario())

    # 전역 리미터였다면 exaone·kt도 앞 호출 뒤에 줄을 서서 기다림이 다섯 번 생긴다.
    assert clock.sleeps == [0.25, 0.5]


def test_default_intervals():
    assert llm._MIN_CALL_INTERVAL == {"ax": 0.25, "exaone": 0.5, "kt": 0.5}


def test_rate_limit_backs_off_only_that_provider_and_still_falls_back(clock, monkeypatch):
    request = httpx.Request("POST", "https://llm.test")

    class Client:
        def __init__(self, name):
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))
            self.name = name

        async def _create(self, **_kwargs):
            if self.name == "ax":
                raise RateLimitError("429", response=httpx.Response(429, request=request), body=None)
            message = SimpleNamespace(content="from exaone")
            return SimpleNamespace(choices=[SimpleNamespace(message=message)])

    monkeypatch.setattr(llm, "_ax_client", lambda: Client("ax"))
    monkeypatch.setattr(llm, "_friendli_client", lambda: Client("exaone"))

    async def scenario():
        result = await llm.chat_completion_with_meta("s", "u")
        before_ax = clock.now
        await llm._throttle("ax")
        return result, clock.now - before_ax

    (content, model), ax_wait = asyncio.run(scenario())

    assert content == "from exaone" and model.startswith("exaone/")  # 폴백 규칙 그대로
    assert ax_wait == pytest.approx(1.0)  # A.X만 1초 늦춘다
    assert clock.sleeps == [1.0]  # EXAONE 폴백은 기다리지 않았다


def _spy_throttle(monkeypatch) -> list[str]:
    calls: list[str] = []
    original = llm._throttle

    async def spy(provider):
        calls.append(provider)
        await original(provider)

    monkeypatch.setattr(llm, "_throttle", spy)
    return calls


def _stream_fakes(monkeypatch, ax_error):
    async def provider(_client, *, model, **_kwargs):
        if model == "A.X-K2":
            raise ax_error
        yield "from exaone"

    monkeypatch.setattr(llm, "_stream_provider", provider)
    monkeypatch.setattr(llm, "_ax_client", lambda: "ax")
    monkeypatch.setattr(llm, "_friendli_client", lambda: "friendli")
    monkeypatch.setattr(llm.settings, "exaone_model", "K-EXAONE")
    monkeypatch.setattr(llm.settings, "axk1_model", "A.X-K2")


async def _collect_stream():
    return [item async for item in llm.chat_completion_stream_with_meta("s", "u")]


def test_ask_stream_waits_on_the_ax_limiter_before_exaone_fallback(clock, monkeypatch):
    # Ask 1순위 A.X도 배치와 같은 A.X 리미터를 거쳐야 A.X 4 RPS를 넘지 않는다. 폴백은 EXAONE 리미터를 쓴다.
    calls = _spy_throttle(monkeypatch)
    _stream_fakes(monkeypatch, ValueError("A.X empty stream"))
    llm._next_call_at["ax"] = clock.now + 0.2  # 배치가 방금 A.X를 불렀다

    assert asyncio.run(_collect_stream()) == [("from exaone", "exaone/K-EXAONE")]
    assert calls == ["ax", "exaone"]
    assert clock.sleeps == [0.2]


def test_ask_stream_ax_rate_limit_backs_off_ax_only(clock, monkeypatch):
    request = httpx.Request("POST", "https://llm.test")
    _stream_fakes(
        monkeypatch, RateLimitError("429", response=httpx.Response(429, request=request), body=None)
    )

    async def scenario():
        answer = await _collect_stream()
        start = clock.now
        await llm._throttle("ax")
        return answer, clock.now - start

    answer, ax_wait = asyncio.run(scenario())

    assert answer == [("from exaone", "exaone/K-EXAONE")]
    assert ax_wait == pytest.approx(1.0)
    assert llm._next_call_at["exaone"] < clock.now + 0.6  # EXAONE은 늦추지 않았다(보통 간격만)


def test_kt_fallback_uses_the_kt_limiter(clock, monkeypatch):
    calls = _spy_throttle(monkeypatch)

    class Client:
        def __init__(self, name):
            self.name = name
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

        async def _create(self, **_kwargs):
            if self.name == "ax":
                raise ValueError("A.X empty")
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="from kt"))])

    monkeypatch.setattr(llm, "_ax_client", lambda: Client("ax"))
    monkeypatch.setattr(llm, "_kt_client", lambda: Client("kt"))
    llm._next_call_at["kt"] = clock.now + 0.3

    assert asyncio.run(llm.chat_completion_light("s", "u")) == "from kt"
    assert calls == ["ax", "kt"]
    assert clock.sleeps == [0.3]
