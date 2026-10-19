import asyncio
from types import SimpleNamespace

from app.schemas.session import SessionSummary
from app.services import embedding_sync


class _Ctx:
    def __init__(self, session):
        self.session = session

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def get(self, _model, _id):
        return self.session

    async def commit(self):
        pass


def _summary():
    return SessionSummary(overview="ov", purpose="pp", highlights=[])


def _patch(monkeypatch, session):
    upserts: list[dict] = []

    async def fake_embed(*_a, **_k):
        return [0.1]

    async def fake_upsert(_sid, _vec, payload):
        upserts.append(payload)

    monkeypatch.setattr(embedding_sync, "embed", fake_embed)
    monkeypatch.setattr(embedding_sync, "upsert_point", fake_upsert)
    monkeypatch.setattr(embedding_sync, "AsyncSessionLocal", lambda: _Ctx(session))
    return upserts


def test_upsert_payload_includes_user_id(monkeypatch):
    session = SimpleNamespace(user_id="u1", embedding_status="pending")
    upserts = _patch(monkeypatch, session)
    asyncio.run(embedding_sync.embed_and_upsert("s1", "t", _summary()))
    assert upserts[0]["user_id"] == "u1"
    assert session.embedding_status == "done"


def test_upsert_skipped_when_session_missing(monkeypatch):
    upserts = _patch(monkeypatch, None)
    asyncio.run(embedding_sync.embed_and_upsert("s1", "t", _summary()))
    assert upserts == []
