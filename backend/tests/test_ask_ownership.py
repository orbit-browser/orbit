"""Ask 경로의 소유권 검증.

`/ask` 는 세션 내용을 읽어 답을 만든다 — 남의 세션 id 로 그 내용을 요약해 받아갈 수
있으면 인증을 붙인 의미가 없다. 인증(401)과 별개로 **소유자 확인**이 필요하다.
"""

import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api import ask
from app.services import ask_service

_NOW = datetime(2026, 8, 7, 12, 0, tzinfo=timezone.utc)

_OWNER = "user-1"
_STRANGER = "user-2"


class _FakeDB:
    """`db.get` 만 쓰는 최소 대역 (`_owned_session` 이 사용)."""

    def __init__(self, session=None):
        self._session = session
        self.executed = []

    async def get(self, _model, _pk):
        return self._session

    async def execute(self, stmt):
        self.executed.append(stmt)
        return SimpleNamespace(
            scalars=lambda: SimpleNamespace(all=lambda: []),
            all=lambda: [],
        )


def _session(user_id=_OWNER, status="active"):
    return SimpleNamespace(
        id="s1",
        user_id=user_id,
        status=status,
        title="세션",
        tabs=[],
        summary={},
        summary_status="done",
        created_at=_NOW,
        updated_at=_NOW,
        last_activity_at=None,
    )


def _body(session_id=None, query="질문"):
    return SimpleNamespace(session_id=session_id, query=query, rerank=False)


# ── _resolve_sources ──────────────────────────────────────────


def test_rejects_session_owned_by_another_user():
    """남의 세션을 지목하면 404 — 403이면 그 id 가 존재한다는 사실을 알려준다."""
    db = _FakeDB(_session(user_id=_STRANGER))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(ask._resolve_sources(_body(session_id="s1"), db, _OWNER))

    assert exc.value.status_code == 404


def test_rejects_missing_session():
    db = _FakeDB(None)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(ask._resolve_sources(_body(session_id="nope"), db, _OWNER))

    assert exc.value.status_code == 404


def test_rejects_merged_session():
    db = _FakeDB(_session(status="merged"))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(ask._resolve_sources(_body(session_id="s1"), db, _OWNER))

    assert exc.value.status_code == 404


def test_accepts_own_session():
    db = _FakeDB(_session())

    sources = asyncio.run(ask._resolve_sources(_body(session_id="s1"), db, _OWNER))

    assert [s.session_id for s in sources] == ["s1"]


def test_vector_search_receives_requesting_user(monkeypatch):
    """세션을 지목하지 않으면 벡터 검색으로 근거를 찾는데, 그 검색도 소유자 범위여야 한다."""
    captured = {}

    async def fake_search(query, limit, rerank, db, user_id):
        captured.update(query=query, limit=limit, rerank=rerank, user_id=user_id)
        return []

    monkeypatch.setattr(ask, "_search_sessions_by_vector", fake_search)

    asyncio.run(ask._resolve_sources(_body(query="교토"), _FakeDB(), _OWNER))

    assert captured["user_id"] == _OWNER
    assert captured["query"] == "교토"


# ── _load_context_records ──────────────────────────────────────


def test_context_loading_filters_by_owner():
    """이중 방어 — 호출측이 걸렀더라도 컨텍스트 로딩에서 한 번 더 소유자를 건다."""
    db = _FakeDB()

    asyncio.run(ask_service._load_context_records(db, ["s1", "s2"], _OWNER))

    assert db.executed, "세션 조회가 실행되지 않았다"
    where_clause = str(db.executed[0])
    assert "user_id" in where_clause, "세션 조회에 소유자 조건이 없다"


def test_context_loading_skips_query_when_no_sessions():
    db = _FakeDB()

    models, events = asyncio.run(ask_service._load_context_records(db, [], _OWNER))

    assert models == {} and events == {}
    assert db.executed == []
