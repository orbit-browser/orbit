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
        folder_id=None,
        folder_assigned_by=None,
        alias=None,
    )


def _body(session_id=None, query="질문", intent="search_memory", history=None):
    return SimpleNamespace(
        session_id=session_id,
        workspace_id=None,
        query=query,
        rerank=False,
        intent=intent,
        history=history or [],
    )


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

    async def fake_search(query, limit, rerank, db, user_id, shared_ids=None, workspace_id=None, **_kwargs):
        captured.update(query=query, limit=limit, rerank=rerank, user_id=user_id, shared_ids=shared_ids)
        return []

    monkeypatch.setattr(ask, "_search_sessions_by_vector", fake_search)

    asyncio.run(ask._resolve_sources(_body(query="교토"), _FakeDB(), _OWNER))

    assert captured["user_id"] == _OWNER
    assert captured["query"] == "교토"


def test_previous_sources_are_loaded_only_for_the_requesting_user():
    """후속 질문의 이전 출처 id는 클라이언트가 보낸 값 — 소유자·활성 조건으로만 불러온다."""
    db = _FakeDB()
    history = [SimpleNamespace(query="이전", answer="답", source_session_ids=["s1", "other"])]

    sources = asyncio.run(ask._previous_sources(_body(history=history), db, _OWNER))

    assert sources == []
    where_clause = str(db.executed[0])
    assert "user_id" in where_clause
    assert "status" in where_clause


def test_previous_sources_skip_query_without_history():
    db = _FakeDB()

    assert asyncio.run(ask._previous_sources(_body(), db, _OWNER)) == []
    assert db.executed == []


def test_followup_search_uses_rewritten_query_and_appends_previous_sources(monkeypatch):
    captured = {}

    async def fake_search(query, limit, rerank, db, user_id, **_kwargs):
        captured["query"] = query
        return [SimpleNamespace(session_id="new"), SimpleNamespace(session_id="prev")]

    async def fake_previous(_body, _db, _user_id):
        return [SimpleNamespace(session_id="prev")]

    monkeypatch.setattr(ask, "_search_sessions_by_vector", fake_search)
    monkeypatch.setattr(ask, "_previous_sources", fake_previous)

    sources = asyncio.run(
        ask._resolve_sources(_body(query="그럼 9070은?"), _FakeDB(), _OWNER, retrieval_query="RX 9070 최저가는?")
    )

    assert captured["query"] == "RX 9070 최저가는?"
    assert [s.session_id for s in sources] == ["new", "prev"]


def test_previous_source_found_again_by_search_stays_exempt_from_relevance_gate(monkeypatch):
    async def fake_search(query, limit, rerank, db, user_id, **_kwargs):
        return [SimpleNamespace(session_id="new", vector_score=0.3), SimpleNamespace(session_id="prev", vector_score=0.2)]

    async def fake_previous(_body, _db, _user_id):
        return [SimpleNamespace(session_id="prev", vector_score=None)]

    monkeypatch.setattr(ask, "_search_sessions_by_vector", fake_search)
    monkeypatch.setattr(ask, "_previous_sources", fake_previous)

    sources = asyncio.run(ask._resolve_sources(_body(query="거기는?"), _FakeDB(), _OWNER, retrieval_query="질문"))

    assert [(s.session_id, s.vector_score) for s in sources] == [("new", 0.3), ("prev", None)]


def test_followup_after_session_discovery_keeps_new_results_and_caps_previous(monkeypatch):
    """직전 턴이 세션 찾기(출처 5개)여도 새 검색 결과가 후보에서 밀려나지 않는다."""
    previous_ids = [f"old{i}" for i in range(5)]

    async def fake_search(query, limit, rerank, db, user_id, **_kwargs):
        return [SimpleNamespace(session_id=f"new{i}") for i in range(5)]

    class _OwnedDB(_FakeDB):
        async def execute(self, stmt):
            self.executed.append(stmt)
            rows = [_session() for _ in previous_ids]
            for row, session_id in zip(rows, previous_ids):
                row.id = session_id
            return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: rows), all=lambda: rows)

    monkeypatch.setattr(ask, "_search_sessions_by_vector", fake_search)
    history = [SimpleNamespace(query="세션 찾아줘", answer="5개", source_session_ids=previous_ids)]

    sources = asyncio.run(ask._resolve_sources(_body(history=history), _OwnedDB(), _OWNER, retrieval_query="질문"))

    ids = [s.session_id for s in sources]
    assert ids[:5] == [f"new{i}" for i in range(5)]
    assert ids[5:] == ["old0", "old1", "old2"]


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

    assert models == {} and events == []
    assert db.executed == []


@pytest.mark.parametrize("intent", ["find_sessions", "search_session", "search_memory"])
def test_team_ask_vector_search_keeps_team_scope_for_every_intent(monkeypatch, intent):
    """팀 Ask는 의도와 상관없이 팀 공유 범위로만 검색한다. 하나라도 범위를 빠뜨리면 개인 세션이 팀 답변에 섞인다."""
    captured = {}

    async def fake_search(query, limit, rerank, db, user_id, shared_ids=None, workspace_id=None, **_kwargs):
        captured.update(shared_ids=shared_ids, workspace_id=workspace_id)
        return []

    monkeypatch.setattr(ask, "_search_sessions_by_vector", fake_search)
    body = _body(intent=intent)
    body.workspace_id = "team-1"

    asyncio.run(ask._resolve_sources(body, _FakeDB(), _OWNER, ["shared-1"]))

    assert captured == {"shared_ids": ["shared-1"], "workspace_id": "team-1"}
