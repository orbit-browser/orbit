import asyncio

import pytest

from app.ai import embedding


@pytest.fixture(autouse=True)
def _empty_cache():
    embedding.clear_cache()
    yield
    embedding.clear_cache()


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _FakeClient:
    def __init__(self, payload, capture):
        self._payload = payload
        self._capture = capture

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_exc):
        return False

    async def post(self, _url, headers=None, json=None):
        self._capture["json"] = json
        return _FakeResponse(self._payload)


def _patch_client(monkeypatch, payload, capture):
    monkeypatch.setattr(
        embedding.httpx, "AsyncClient", lambda *a, **k: _FakeClient(payload, capture)
    )


def test_embed_many_empty_returns_empty_without_request(monkeypatch):
    def boom(*_a, **_k):
        raise AssertionError("빈 입력은 요청을 보내면 안 됨")

    monkeypatch.setattr(embedding.httpx, "AsyncClient", boom)
    assert asyncio.run(embedding.embed_many([])) == []


def test_embed_many_preserves_order_even_if_response_shuffled(monkeypatch):
    capture: dict = {}
    payload = {
        "data": [
            {"index": 2, "embedding": [3.0]},
            {"index": 0, "embedding": [1.0]},
            {"index": 1, "embedding": [2.0]},
        ]
    }
    _patch_client(monkeypatch, payload, capture)

    result = asyncio.run(embedding.embed_many(["a", "b", "c"]))

    assert result == [[1.0], [2.0], [3.0]]
    # 배열 입력을 그대로 보냈는지 확인
    assert capture["json"]["input"] == ["a", "b", "c"]


def test_embed_many_splits_over_provider_batch_limit(monkeypatch):
    sent: list[list[str]] = []

    class _EchoClient(_FakeClient):
        async def post(self, _url, headers=None, json=None):
            sent.append(json["input"])
            return _FakeResponse(
                {"data": [{"index": i, "embedding": [float(t)]} for i, t in enumerate(json["input"])]}
            )

    monkeypatch.setattr(embedding.httpx, "AsyncClient", lambda *a, **k: _EchoClient(None, {}))
    texts = [str(i) for i in range(250)]

    result = asyncio.run(embedding.embed_many(texts))

    assert [len(batch) for batch in sent] == [100, 100, 50]
    assert result == [[float(i)] for i in range(250)]


class _CountingClient(_FakeClient):
    def __init__(self, sent):
        super().__init__(None, {})
        self._sent = sent

    async def post(self, _url, headers=None, json=None):
        inputs = json["input"] if isinstance(json["input"], list) else [json["input"]]
        self._sent.append(inputs)
        data = [{"index": i, "embedding": [float(len(t))]} for i, t in enumerate(inputs)]
        return _FakeResponse({"data": data})


def test_embed_many_reuses_cached_vectors_and_requests_only_misses(monkeypatch):
    sent: list[list[str]] = []
    monkeypatch.setattr(embedding.httpx, "AsyncClient", lambda *a, **k: _CountingClient(sent))

    first = asyncio.run(embedding.embed_many(["a", "bb"], model="m"))
    second = asyncio.run(embedding.embed_many(["bb", "ccc", "a", "ccc"], model="m"))

    assert sent == [["a", "bb"], ["ccc"]]
    assert first == [[1.0], [2.0]]
    assert second == [[2.0], [3.0], [1.0], [3.0]]


def test_cache_is_keyed_by_model_and_shared_with_embed(monkeypatch):
    sent: list[list[str]] = []
    monkeypatch.setattr(embedding.httpx, "AsyncClient", lambda *a, **k: _CountingClient(sent))

    asyncio.run(embedding.embed("질문", model="query"))
    asyncio.run(embedding.embed_many(["질문"], model="query"))
    asyncio.run(embedding.embed_many(["질문"], model="passage"))

    assert sent == [["질문"], ["질문"]]


def test_cache_evicts_least_recently_used(monkeypatch):
    sent: list[list[str]] = []
    monkeypatch.setattr(embedding.httpx, "AsyncClient", lambda *a, **k: _CountingClient(sent))
    monkeypatch.setattr(embedding, "_CACHE_MAX", 2)

    asyncio.run(embedding.embed_many(["a", "b"], model="m"))
    asyncio.run(embedding.embed("a", model="m"))  # a를 최근으로
    asyncio.run(embedding.embed("c", model="m"))  # b가 밀려난다
    asyncio.run(embedding.embed_many(["a", "b"], model="m"))

    assert sent == [["a", "b"], ["c"], ["b"]]


def test_embed_many_rejects_short_provider_response(monkeypatch):
    class _ShortClient(_FakeClient):
        async def post(self, _url, headers=None, json=None):
            return _FakeResponse({"data": [{"index": 0, "embedding": [1.0]}]})

    monkeypatch.setattr(embedding.httpx, "AsyncClient", lambda *a, **k: _ShortClient(None, {}))

    with pytest.raises(ValueError):
        asyncio.run(embedding.embed_many(["a", "b"], model="m"))
