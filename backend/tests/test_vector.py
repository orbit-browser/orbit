import asyncio
from types import SimpleNamespace

from app.db import vector


def test_search_similar_passes_score_threshold(monkeypatch):
    captured: dict = {}

    class FakeClient:
        async def query_points(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(points=[SimpleNamespace(id="session-1")])

    monkeypatch.setattr(vector, "get_qdrant", lambda: FakeClient())
    monkeypatch.setattr(vector.settings, "search_score_threshold", 0.35)

    result = asyncio.run(vector.search_similar([0.1, 0.2], limit=7))

    assert result == ["session-1"]
    assert captured["limit"] == 7
    assert captured["score_threshold"] == 0.35
