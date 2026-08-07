import asyncio

from app.ai import embedding


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
