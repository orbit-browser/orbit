"""팀 워크스페이스 — 권한 규칙과 팀 범위 격리.

핵심 계약: 팀원이 읽을 수 있는 것은 **그 팀에 공유된 세션**뿐이다. 팀원의 공유하지 않은
세션·방문은 팀 목록·검색·Ask 어디에도 섞이면 안 된다.
"""

import asyncio
import re
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from qdrant_client.models import HasIdCondition

from app.api import ask, search, sessions, workspaces
from app.db import vector
from app.db.models import WorkspaceMember, WorkspaceSession
from app.schemas.workspace import CreateWorkspaceRequest, JoinWorkspaceRequest, ShareSessionsRequest
from app.services import merge_service
from app.services import workspaces as workspace_service

_NOW = datetime(2026, 10, 17, 12, 0, tzinfo=timezone.utc)
_WS = "ws-1"
_OWNER = "owner-1"
_MEMBER = "member-1"
_STRANGER = "stranger-1"


class _Result:
    def __init__(self, items=None, rows=None):
        self._items = items or []
        self._rows = rows or []

    def scalars(self):
        return SimpleNamespace(all=lambda: list(self._items))

    def all(self):
        return list(self._rows)


class _FakeDB:
    """워크스페이스 라우터가 쓰는 만큼만 흉내 낸다. execute 결과는 큐에서 순서대로 꺼낸다."""

    def __init__(self, members=(), shares=(), results=(), scalar=None, sessions_by_id=None):
        self.members = {(m.workspace_id, m.user_id): m for m in members}
        self.shares = {(s.workspace_id, s.session_id): s for s in shares}
        self.sessions_by_id = sessions_by_id or {}
        self._results = list(results)
        self._scalar = scalar
        self.executed: list = []
        self.added: list = []
        self.deleted: list = []
        self.committed = False

    async def get(self, model, pk):
        if model is WorkspaceMember:
            return self.members.get(pk)
        if model is WorkspaceSession:
            return self.shares.get(pk)
        return self.sessions_by_id.get(pk)

    async def execute(self, stmt):
        self.executed.append(stmt)
        return self._results.pop(0) if self._results else _Result()

    async def scalar(self, stmt):
        self.executed.append(stmt)
        return self._scalar

    def add(self, obj):
        self.added.append(obj)

    def add_all(self, objs):
        self.added.extend(objs)

    async def delete(self, obj):
        self.deleted.append(obj)

    async def commit(self):
        self.committed = True


def _member(user_id, role="member", workspace_id=_WS):
    return SimpleNamespace(workspace_id=workspace_id, user_id=user_id, role=role, joined_at=_NOW)


def _share(session_id, shared_by, workspace_id=_WS):
    return SimpleNamespace(
        workspace_id=workspace_id, session_id=session_id, shared_by=shared_by, shared_at=_NOW
    )


def _session(session_id="s1", user_id=_OWNER, status="active"):
    return SimpleNamespace(
        id=session_id,
        user_id=user_id,
        status=status,
        title="세션",
        alias=None,
        tabs=[],
        summary={},
        summary_status="done",
        created_at=_NOW,
        updated_at=_NOW,
        last_activity_at=None,
        folder_id="private-folder",
        folder_assigned_by="user",
    )


def _team_db(**kwargs):
    return _FakeDB(members=[_member(_OWNER, "owner"), _member(_MEMBER)], **kwargs)


def _status_of(coro) -> int:
    with pytest.raises(HTTPException) as exc:
        asyncio.run(coro)
    return exc.value.status_code


def _sql(stmt) -> str:
    return str(stmt.compile(compile_kwargs={"literal_binds": True}))


def _where(stmt) -> str:
    """SELECT 목록에 같은 컬럼 이름이 나오므로 조건 검사는 WHERE 절만 본다."""
    return _sql(stmt).split("WHERE", 1)[1]


# ── 요청 스키마 ──────────────────────────────────────────


def test_workspace_name_is_trimmed_and_blank_rejected():
    assert CreateWorkspaceRequest(name="  리서치 팀 ").name == "리서치 팀"
    with pytest.raises(ValidationError):
        CreateWorkspaceRequest(name="   ")
    with pytest.raises(ValidationError):
        CreateWorkspaceRequest(name="a" * 61)


def test_workspace_name_length_is_checked_after_trim():
    """공백이 섞여 61자를 넘어도 지운 뒤 60자면 받아들인다."""
    assert CreateWorkspaceRequest(name=" " + "a" * 60 + " ").name == "a" * 60


def test_join_code_is_trimmed():
    assert JoinWorkspaceRequest(code=" abc\n").code == "abc"
    with pytest.raises(ValidationError):
        JoinWorkspaceRequest(code="  ")


def test_share_request_caps_batch_size():
    with pytest.raises(ValidationError):
        ShareSessionsRequest(session_ids=[])
    with pytest.raises(ValidationError):
        ShareSessionsRequest(session_ids=[str(i) for i in range(201)])


# ── 초대 코드 ──────────────────────────────────────────


def test_invite_code_is_random_and_only_hash_is_kept():
    code_a, hash_a = workspace_service.new_invite_code()
    code_b, _hash_b = workspace_service.new_invite_code()
    assert code_a != code_b
    assert hash_a == workspace_service.hash_invite_code(code_a)
    assert code_a not in hash_a


def test_join_rejects_unknown_or_expired_code():
    db = _FakeDB(scalar=None)
    assert _status_of(workspaces.join_workspace(JoinWorkspaceRequest(code="nope"), db, _STRANGER)) == 400
    assert db.added == []


def test_join_adds_member_once():
    workspace = SimpleNamespace(id=_WS, name="팀", hue="#fff", created_at=_NOW)
    db = _FakeDB(scalar=workspace, results=[_Result(rows=[(_WS, 2)])])

    item = asyncio.run(workspaces.join_workspace(JoinWorkspaceRequest(code="ok"), db, _STRANGER))

    assert item.role == "member"
    assert item.member_count == 2
    assert [(m.user_id, m.role) for m in db.added] == [(_STRANGER, "member")]


def test_join_is_idempotent_for_existing_member():
    workspace = SimpleNamespace(id=_WS, name="팀", hue="#fff", created_at=_NOW)
    db = _team_db(scalar=workspace, results=[_Result(rows=[(_WS, 2)])])

    item = asyncio.run(workspaces.join_workspace(JoinWorkspaceRequest(code="ok"), db, _OWNER))

    assert item.role == "owner"  # 다시 참여해도 owner 가 member 로 강등되지 않는다
    assert db.added == []


# ── 멤버십·역할 ──────────────────────────────────────────


def test_non_member_cannot_see_team():
    db = _team_db()
    assert _status_of(workspaces.list_members(_WS, db, _STRANGER)) == 404
    assert _status_of(workspaces.list_workspace_sessions(_WS, db, _STRANGER)) == 404
    assert _status_of(
        workspaces.share_sessions(_WS, ShareSessionsRequest(session_ids=["s1"]), db, _STRANGER)
    ) == 404


def test_owner_only_actions_are_forbidden_to_members():
    db = _team_db()
    assert _status_of(workspaces.issue_invite_code(_WS, db, _MEMBER)) == 403
    assert _status_of(workspaces.delete_workspace(_WS, db, _MEMBER)) == 403
    assert _status_of(
        workspaces.update_workspace(_WS, CreateWorkspaceRequest(name="x"), db, _MEMBER)
    ) == 403
    assert db.committed is False


def _member_rows():
    owner = _member(_OWNER, "owner")
    member = _member(_MEMBER)
    return [
        (owner, SimpleNamespace(name="소유자", email="owner@ex.com", picture=None)),
        (member, SimpleNamespace(name="팀원", email="member@ex.com", picture=None)),
    ]


def test_member_list_shows_emails_to_owner():
    db = _team_db(results=[_Result(rows=_member_rows())])
    items = asyncio.run(workspaces.list_members(_WS, db, _OWNER))
    assert [item.email for item in items] == ["owner@ex.com", "member@ex.com"]


def test_member_list_hides_other_emails_from_members():
    """초대 코드가 퍼지면 모르는 사람도 들어올 수 있다 — 팀원끼리는 이름·사진만 본다."""
    db = _team_db(results=[_Result(rows=_member_rows())])
    items = asyncio.run(workspaces.list_members(_WS, db, _MEMBER))
    assert [item.email for item in items] == [None, "member@ex.com"]
    assert [item.name for item in items] == ["소유자", "팀원"]


def test_owner_cannot_leave():
    db = _team_db()
    assert _status_of(workspaces.remove_member(_WS, _OWNER, db, _OWNER)) == 409


def test_member_leaving_unshares_only_their_sessions():
    db = _team_db()

    asyncio.run(workspaces.remove_member(_WS, _MEMBER, db, _MEMBER))

    (stmt,) = db.executed
    sql = _sql(stmt)
    assert "DELETE FROM workspace_sessions" in sql
    assert f"workspace_sessions.shared_by = '{_MEMBER}'" in sql
    assert f"workspace_sessions.workspace_id = '{_WS}'" in sql
    assert [m.user_id for m in db.deleted] == [_MEMBER]
    assert db.committed is True


def test_member_cannot_remove_others():
    db = _team_db()
    assert _status_of(workspaces.remove_member(_WS, _OWNER, db, _MEMBER)) == 403


def test_owner_removing_unknown_member_is_404():
    db = _team_db()
    assert _status_of(workspaces.remove_member(_WS, _STRANGER, db, _OWNER)) == 404


def test_owner_kicking_member_invalidates_invite_code():
    """내보낸 사람이 아직 유효한 같은 코드로 다시 들어오면 내보내기가 무의미하다."""
    workspace = SimpleNamespace(id=_WS, invite_code_hash="h", invite_expires_at=_NOW)
    db = _team_db(sessions_by_id={_WS: workspace})

    asyncio.run(workspaces.remove_member(_WS, _MEMBER, db, _OWNER))

    assert workspace.invite_code_hash is None
    assert workspace.invite_expires_at is None
    assert [m.user_id for m in db.deleted] == [_MEMBER]


def test_member_leaving_keeps_invite_code():
    workspace = SimpleNamespace(id=_WS, invite_code_hash="h", invite_expires_at=_NOW)
    db = _team_db(sessions_by_id={_WS: workspace})

    asyncio.run(workspaces.remove_member(_WS, _MEMBER, db, _MEMBER))

    assert workspace.invite_code_hash == "h"


# ── 공유 ──────────────────────────────────────────


def test_share_only_own_live_sessions_and_is_idempotent():
    db = _team_db(
        results=[
            _Result(items=["mine-new", "mine-shared"]),  # 내 소유이면서 흡수되지 않은 세션
            _Result(items=["mine-shared"]),  # 이미 공유된 것
        ]
    )
    body = ShareSessionsRequest(session_ids=["mine-new", "mine-shared", "someone-else", "mine-new"])

    result = asyncio.run(workspaces.share_sessions(_WS, body, db, _MEMBER))

    assert result.shared == ["mine-new", "mine-shared"]
    assert result.skipped == ["someone-else"]
    assert [(row.session_id, row.shared_by) for row in db.added] == [("mine-new", _MEMBER)]
    owned_sql = _sql(db.executed[0])
    assert f"sessions.user_id = '{_MEMBER}'" in owned_sql
    assert "sessions.status != 'merged'" in owned_sql


def test_unshare_requires_sharer_or_owner():
    db = _team_db(shares=[_share("s1", _OWNER)])
    assert _status_of(workspaces.unshare_session(_WS, "s1", db, _MEMBER)) == 403
    assert _status_of(workspaces.unshare_session(_WS, "missing", db, _MEMBER)) == 404

    asyncio.run(workspaces.unshare_session(_WS, "s1", db, _OWNER))
    assert [s.session_id for s in db.deleted] == ["s1"]


def test_owner_can_unshare_members_session():
    db = _team_db(shares=[_share("s2", _MEMBER)])
    asyncio.run(workspaces.unshare_session(_WS, "s2", db, _OWNER))
    assert [s.session_id for s in db.deleted] == ["s2"]


# ── 팀 범위 ──────────────────────────────────────────


def test_team_scope_is_none_without_workspace():
    """workspace_id 가 없으면 개인 범위 — DB를 열지 않는다."""
    assert asyncio.run(workspaces.team_shared_ids(None, _MEMBER, None)) is None


def test_team_scope_rejects_non_member():
    assert _status_of(workspaces.team_shared_ids(_team_db(), _STRANGER, _WS)) == 404


def test_team_scope_lists_only_live_shared_sessions():
    db = _team_db(results=[_Result(items=["s1"])])
    assert asyncio.run(workspaces.team_shared_ids(db, _MEMBER, _WS)) == ["s1"]
    sql = _sql(db.executed[0])
    assert f"workspace_sessions.workspace_id = '{_WS}'" in sql
    assert "sessions.status != 'merged'" in sql


def test_shares_count_only_while_sharer_is_member():
    """탈퇴와 동시에 들어온 공유가 남아도 팀 범위·목록·읽기 판정에서 빠진다."""
    db = _team_db(results=[_Result(items=[]), _Result(rows=[])])

    asyncio.run(workspace_service.shared_session_ids(db, _WS))
    asyncio.run(workspaces.list_workspace_sessions(_WS, db, _MEMBER))
    asyncio.run(workspace_service.is_shared_with(db, "s1", _MEMBER))

    sharer_join = "workspace_members.user_id = workspace_sessions.shared_by"
    assert sharer_join in _sql(db.executed[0])
    assert sharer_join in _sql(db.executed[1])
    # 읽기 판정은 보는 사람과 공유한 사람을 각각 별칭으로 조인한다.
    assert re.search(r"workspace_members_\d+\.user_id = workspace_sessions\.shared_by", _sql(db.executed[2]))


def test_scope_clause_switches_between_owner_and_current_team_access():
    personal = _sql(workspace_service.session_scope_clause("u1", None))
    team = _sql(workspace_service.session_scope_clause("u1", _WS))
    assert personal == "sessions.user_id = 'u1'"
    assert "sessions.id IN (SELECT workspace_sessions.session_id" in team
    assert f"workspace_sessions.workspace_id = '{_WS}'" in team
    assert re.search(r"workspace_members_\d+\.user_id = 'u1'", team)
    assert re.search(r"workspace_members_\d+\.user_id = workspace_sessions\.shared_by", team)
    assert "sessions.status != 'merged'" in team


def test_team_keyword_search_reads_only_events_in_shared_sessions():
    """세션에 묶이지 않은 방문, 공유하지 않은 세션의 방문은 팀 검색에 나오면 안 된다."""
    db = _FakeDB(results=[_Result(rows=[])])

    asyncio.run(search._fetch_keyword_matched_events(db, "q", set(), _MEMBER, _WS))

    where = _where(db.executed[0])
    assert "sessions.id IN (SELECT workspace_sessions.session_id" in where
    assert f"workspace_sessions.workspace_id = '{_WS}'" in where
    assert "exploration_events.user_id" not in where


def test_team_vector_search_skips_embedding_when_nothing_shared(monkeypatch):
    async def fail_embed(_q):
        raise AssertionError("공유 세션이 없으면 임베딩을 부르지 않는다")

    monkeypatch.setattr(search, "embed", fail_embed)

    result = asyncio.run(search._search_sessions_by_vector("q", 5, False, None, _MEMBER, [], _WS))

    assert result == []


def test_team_vector_search_filters_points_by_shared_ids(monkeypatch):
    captured: dict = {}

    class FakeClient:
        async def query_points(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(points=[])

    monkeypatch.setattr(vector, "get_qdrant", lambda: FakeClient())

    asyncio.run(vector.search_similar([0.1], limit=3, user_id=_MEMBER, session_ids=["s1"]))

    (condition,) = captured["query_filter"].must
    assert isinstance(condition, HasIdCondition)
    assert condition.has_id == ["s1"]


def test_team_vector_search_with_empty_ids_does_not_query(monkeypatch):
    def fail_client():
        raise AssertionError("빈 id 목록으로 Qdrant 를 부르지 않는다")

    monkeypatch.setattr(vector, "get_qdrant", fail_client)

    assert asyncio.run(vector.search_similar([0.1], user_id=_MEMBER, session_ids=[])) == []


# ── Ask 팀 범위 ──────────────────────────────────────────


def _ask_body(session_id=None):
    return SimpleNamespace(
        session_id=session_id, query="질문", rerank=False, intent="search_memory", workspace_id=_WS,
    )


def test_team_ask_rejects_session_not_shared_with_team():
    """내 세션이라도 이 팀에 공유하지 않았으면 팀 범위 Ask 근거가 될 수 없다."""
    db = _FakeDB(sessions_by_id={"mine": _session("mine", _MEMBER)})
    with pytest.raises(HTTPException) as exc:
        asyncio.run(ask._resolve_sources(_ask_body("mine"), db, _MEMBER, ["s1"]))
    assert exc.value.status_code == 404


def test_team_ask_accepts_shared_session_of_teammate():
    db = _FakeDB(scalar=_session("s1", _OWNER))
    (source,) = asyncio.run(ask._resolve_sources(_ask_body("s1"), db, _MEMBER, ["s1"]))
    assert source.session_id == "s1"


def test_team_ask_context_loads_by_current_team_access_not_owner():
    from app.services import ask_service

    db = _FakeDB(results=[_Result(items=[])])

    asyncio.run(ask_service._load_context_records(db, ["s1"], _MEMBER, _WS))

    where = _where(db.executed[0])
    assert "sessions.id IN (SELECT workspace_sessions.session_id" in where
    assert f"workspace_sessions.workspace_id = '{_WS}'" in where
    assert "sessions.user_id" not in where


# ── 공유 세션 읽기 ──────────────────────────────────────────


def test_teammate_can_read_shared_session_but_not_unshared(monkeypatch):
    async def shared_only_s1(_db, session_id, _user_id):
        return session_id == "s1"

    monkeypatch.setattr(sessions, "is_shared_with", shared_only_s1)
    db = _FakeDB(sessions_by_id={"s1": _session("s1"), "s2": _session("s2")})

    assert asyncio.run(sessions._readable_session(db, "s1", _MEMBER)).id == "s1"
    assert _status_of(sessions._readable_session(db, "s2", _MEMBER)) == 404


def test_teammate_cannot_read_absorbed_shared_session(monkeypatch):
    """흡수된 세션은 팀 목록·검색에서 빠지므로 id 로도 읽을 수 없어야 한다. 소유자는 읽는다."""
    async def shared(_db, _session_id, _user_id):
        return True

    monkeypatch.setattr(sessions, "is_shared_with", shared)
    db = _FakeDB(sessions_by_id={"s1": _session("s1", _OWNER, status="merged")})

    assert _status_of(sessions._readable_session(db, "s1", _MEMBER)) == 404
    assert asyncio.run(sessions._readable_session(db, "s1", _OWNER)).id == "s1"


def test_teammate_does_not_learn_other_team_shares(monkeypatch):
    async def shared(_db, _session_id, _user_id):
        return True

    async def other_teams(_db, _ids):
        return {"s1": [_WS, "other-team"]}

    monkeypatch.setattr(sessions, "is_shared_with", shared)
    monkeypatch.setattr(sessions, "shared_workspaces", other_teams)
    db = _FakeDB(sessions_by_id={"s1": _session("s1", _OWNER)})

    as_teammate = asyncio.run(sessions.get_session("s1", db, _MEMBER))
    as_owner = asyncio.run(sessions.get_session("s1", db, _OWNER))

    assert as_teammate.shared_workspace_ids == []
    assert as_teammate.folder_id is None  # 소유자 개인 폴더도 알려 주지 않는다
    assert as_owner.shared_workspace_ids == [_WS, "other-team"]
    assert as_owner.folder_id == "private-folder"


def test_team_list_hides_sharers_private_folder():
    share = _share("s1", _OWNER)
    user = SimpleNamespace(name="소유자", picture=None)
    db = _team_db(results=[_Result(rows=[(_session("s1"), share, user)])])

    (item,) = asyncio.run(workspaces.list_workspace_sessions(_WS, db, _MEMBER))

    assert item.folder_id is None
    assert item.shared_by.name == "소유자"


def test_team_search_results_hide_private_fields(monkeypatch):
    async def fake_embed(_q):
        return [0.1]

    async def fake_search(_vector, *, limit, user_id, session_ids):
        assert session_ids == ["s1"]
        return ["s1"]

    monkeypatch.setattr(search, "embed", fake_embed)
    monkeypatch.setattr(search, "search_similar", fake_search)
    db = _FakeDB(results=[_Result(items=[_session("s1")])])

    (result,) = asyncio.run(search._search_sessions_by_vector("q", 5, False, db, _MEMBER, ["s1"], _WS))

    assert result.folder_id is None


def test_delete_session_removes_share_rows(monkeypatch):
    async def no_point(_session_id):
        pass

    monkeypatch.setattr(sessions, "delete_point", no_point)
    db = _FakeDB(sessions_by_id={"s1": _session("s1", _OWNER)})

    asyncio.run(sessions.delete_session("s1", db, _OWNER))

    assert any("DELETE FROM workspace_sessions" in _sql(stmt) for stmt in db.executed)


# ── 자동병합 가드 ──────────────────────────────────────────


def test_auto_merge_skips_shared_sessions(monkeypatch):
    suggestions = [
        SimpleNamespace(
            survivor_id=survivor, absorbed_id=absorbed, score=0.99,
            survivor_title="같은 주제", absorbed_title="같은 주제",
        )
        for survivor, absorbed in (("shared", "a"), ("b", "c"))
    ]
    merged: list = []

    async def fake_suggestions(_db, _user_id):
        return suggestions

    async def fake_shared(_db, _ids):
        return {"shared": [_WS]}

    async def fake_merge(_db, survivor_id, absorbed_id):
        merged.append((survivor_id, absorbed_id))

    monkeypatch.setattr(merge_service, "find_merge_suggestions", fake_suggestions)
    monkeypatch.setattr(merge_service, "shared_workspaces", fake_shared)
    monkeypatch.setattr(merge_service, "is_auto_merge_candidate", lambda *a, **k: True)
    monkeypatch.setattr(merge_service, "merge_sessions", fake_merge)

    result = asyncio.run(merge_service.auto_merge_duplicates(object(), _OWNER))

    assert result == [("b", "c")]
    assert merged == [("b", "c")]
