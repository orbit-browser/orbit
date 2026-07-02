import asyncio

from app.ai import reranker


class FakeSummary:
    def __init__(self, overview: str = "", purpose: str = ""):
        self.overview = overview
        self.purpose = purpose


class FakeSession:
    def __init__(self, title: str):
        self.title = title
        self.summary = FakeSummary()
        self.tabs: list = []


def test_rerank_restores_order_and_recovers_missing_index(monkeypatch):
    sessions = [FakeSession("a"), FakeSession("b"), FakeSession("c")]

    async def fake_llm(*_a, **_k):
        return '{"ranked": [2, 0]}'

    monkeypatch.setattr(reranker, "chat_completion_light", fake_llm)

    result = asyncio.run(reranker.rerank("query", sessions))
    # 인덱스 1(b)은 LLM 응답에서 빠졌으므로 뒤에 회수됨
    assert [s.title for s in result] == ["c", "a", "b"]


def test_rerank_single_session_skips_llm(monkeypatch):
    async def boom(*_a, **_k):
        raise AssertionError("세션이 1개 이하면 LLM을 호출하지 않아야 함")

    monkeypatch.setattr(reranker, "chat_completion_light", boom)

    sessions = [FakeSession("only")]
    result = asyncio.run(reranker.rerank("q", sessions))
    assert result == sessions


def test_rerank_failure_keeps_original_order(monkeypatch):
    async def boom(*_a, **_k):
        raise RuntimeError("fail")

    monkeypatch.setattr(reranker, "chat_completion_light", boom)

    sessions = [FakeSession("a"), FakeSession("b")]
    result = asyncio.run(reranker.rerank("q", sessions))
    assert result == sessions
