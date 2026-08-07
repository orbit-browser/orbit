import asyncio
from types import SimpleNamespace

from app.services import app_settings


class _FakeDB:
    def __init__(self, existing=None):
        self._store = dict(existing or {})
        self.added = []
        self.committed = False

    async def get(self, _model, key):
        return self._store.get(key)

    def add(self, obj):
        self.added.append(obj)
        self._store[obj.key] = obj

    async def commit(self):
        self.committed = True


def _row(key, value):
    return SimpleNamespace(key=key, value=value)


# ── get_bool ──────────────────────────────────────────────


def test_get_bool_returns_default_when_missing():
    db = _FakeDB()
    assert asyncio.run(app_settings.get_bool(db, "auto_merge_enabled", False)) is False
    assert asyncio.run(app_settings.get_bool(db, "auto_merge_enabled", True)) is True


def test_get_bool_returns_stored_value():
    db = _FakeDB({"auto_merge_enabled": _row("auto_merge_enabled", True)})
    assert asyncio.run(app_settings.get_bool(db, "auto_merge_enabled", False)) is True


def test_get_bool_falls_back_when_value_not_bool():
    # JSONB에 예상치 못한 형식이 들어와도 default로 안전 복귀
    db = _FakeDB({"auto_merge_enabled": _row("auto_merge_enabled", "yes")})
    assert asyncio.run(app_settings.get_bool(db, "auto_merge_enabled", False)) is False


# ── set_bool ──────────────────────────────────────────────


def test_set_bool_inserts_when_missing():
    db = _FakeDB()
    asyncio.run(app_settings.set_bool(db, "auto_merge_enabled", True))
    assert db.added and db.added[0].key == "auto_merge_enabled"
    assert db.added[0].value is True
    assert db.committed is True


def test_set_bool_updates_existing():
    row = _row("auto_merge_enabled", False)
    db = _FakeDB({"auto_merge_enabled": row})
    asyncio.run(app_settings.set_bool(db, "auto_merge_enabled", True))
    assert row.value is True
    assert db.added == []  # 기존 행 갱신 — 새로 add하지 않음
    assert db.committed is True
