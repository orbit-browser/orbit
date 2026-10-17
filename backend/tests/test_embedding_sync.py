"""세션 임베딩 저장과 소유자 payload backfill."""

import asyncio
from types import SimpleNamespace

from app.schemas.session import SessionSummary
from app.services import embedding_sync


class _SessionCtx:
    def __init__(self, db):
        self._db = db

    async def __aenter__(self):
        return self._db

    async def __aexit__(self, *_exc):
        return False


class _FakeDB:
    def __init__(self, owner=None, rows=None):
        self.owner = owner
        self.rows = rows or []
        self.session = SimpleNamespace(embedding_status="pending")

    async def scalar(self, _stmt):
        return self.owner

    async def execute(self, _stmt):
        return SimpleNamespace(all=lambda: self.rows)

    async def get(self, _model, _pk):
        return self.session if self.owner else None

    async def commit(self):
        pass


def _summary() -> SessionSummary:
    return SessionSummary(overview="개요", purpose="목적", highlights=[])


def test_embed_and_upsert_stores_owner_in_payload(monkeypatch):
    db = _FakeDB(owner="u1")
    upserts: list = []

    async def fake_embed(_text, model):
        return [0.1]

    async def fake_upsert(session_id, _vector, payload):
        upserts.append((session_id, payload))

    monkeypatch.setattr(embedding_sync, "AsyncSessionLocal", lambda: _SessionCtx(db))
    monkeypatch.setattr(embedding_sync, "embed", fake_embed)
    monkeypatch.setattr(embedding_sync, "upsert_point", fake_upsert)

    asyncio.run(embedding_sync.embed_and_upsert("s1", "제목", _summary()))

    assert upserts[0][0] == "s1"
    assert upserts[0][1]["user_id"] == "u1"
    assert db.session.embedding_status == "done"


def test_embed_and_upsert_skips_deleted_session(monkeypatch):
    """요약 중에 세션이 지워졌으면 고아 포인트를 만들지 않는다."""
    db = _FakeDB(owner=None)
    called: list = []

    async def fake_embed(*_a, **_k):
        called.append("embed")
        return [0.1]

    monkeypatch.setattr(embedding_sync, "AsyncSessionLocal", lambda: _SessionCtx(db))
    monkeypatch.setattr(embedding_sync, "embed", fake_embed)

    asyncio.run(embedding_sync.embed_and_upsert("gone", "제목", _summary()))

    assert called == []


def test_backfill_groups_points_by_owner(monkeypatch):
    db = _FakeDB(rows=[("s1", "u1"), ("s2", "u2"), ("s3", "u1")])
    applied: dict = {}

    async def fake_missing():
        return ["s1", "s2", "s3", "orphan"]

    async def fake_set_owner(user_id, session_ids):
        applied[user_id] = session_ids

    monkeypatch.setattr(embedding_sync, "AsyncSessionLocal", lambda: _SessionCtx(db))
    monkeypatch.setattr(embedding_sync, "point_ids_missing_owner", fake_missing)
    monkeypatch.setattr(embedding_sync, "set_owner", fake_set_owner)

    asyncio.run(embedding_sync.backfill_owner_payload())

    assert applied == {"u1": ["s1", "s3"], "u2": ["s2"]}


def test_backfill_does_nothing_when_all_points_have_owner(monkeypatch):
    async def fake_missing():
        return []

    def fail_session():
        raise AssertionError("DB를 열 필요가 없다")

    monkeypatch.setattr(embedding_sync, "point_ids_missing_owner", fake_missing)
    monkeypatch.setattr(embedding_sync, "AsyncSessionLocal", fail_session)

    asyncio.run(embedding_sync.backfill_owner_payload())


def test_backfill_failure_does_not_block_startup(monkeypatch):
    async def failing_missing():
        raise RuntimeError("qdrant down")

    monkeypatch.setattr(embedding_sync, "point_ids_missing_owner", failing_missing)

    asyncio.run(embedding_sync.backfill_owner_payload())  # 예외를 올리지 않는다
