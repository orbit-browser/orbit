"""Independent workspace isolation checks with real SQL against an in-memory DB.

SQLite replaces PostgreSQL only for these relational queries; JSONB DDL is copied
as JSON. This does not claim to exercise PostgreSQL locking or its scheduler.
External ranking, vector search and answer generation are explicit test doubles.
"""

import asyncio
import hashlib
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi import FastAPI, Request
from sqlalchemy import JSON, MetaData, create_engine, select, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session as SyncSession

from app.api import ask, folders, search, sessions, workspaces
from app.api.deps import current_user_id
from app.db.models import (
    Base, ExplorationEvent, Folder, RecommendationCache, Session, SessionEvent,
    SessionVersion, User, Workspace, WorkspaceMember, WorkspaceSession,
)
from app.db.session import get_db
from app.services import ask_service
from app.services import workspaces as workspace_service
from app.services.recommender import service as recommender
from app.services.recommender.llm_rerank import RecommendationContext


class MemoryDB:
    """Async-shaped adapter; the production statements execute unchanged."""

    def __init__(self, session):
        self.sync = session

    async def get(self, model, key):
        return self.sync.get(model, key)

    async def execute(self, statement):
        return self.sync.execute(statement)

    async def scalar(self, statement):
        return self.sync.scalar(statement)

    def add(self, value):
        self.sync.add(value)

    def add_all(self, values):
        self.sync.add_all(values)

    async def delete(self, value):
        self.sync.delete(value)

    async def commit(self):
        self.sync.commit()

    async def refresh(self, value):
        self.sync.refresh(value)

    async def flush(self):
        self.sync.flush()


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    metadata = MetaData()
    for table in Base.metadata.sorted_tables:
        copied = table.to_metadata(metadata)
        for column in copied.columns:
            if isinstance(column.type, JSONB):
                column.type = JSON()
    metadata.create_all(engine)
    with SyncSession(engine, expire_on_commit=False) as sync:
        sync.execute(text("PRAGMA foreign_keys=ON"))
        sync.add_all([
            User(id=user, google_sub=user, email=f"{user}@example.test", name=user)
            for user in ("alice", "bob", "eve", "departed")
        ])
        sync.add_all([
            Workspace(id=team, name=team, hue="#000")
            for team in ("alpha", "beta", "empty")
        ])
        sync.flush()
        sync.add_all([
            WorkspaceMember(workspace_id=team, user_id=user, role=role)
            for team, user, role in (
                ("alpha", "alice", "owner"), ("alpha", "bob", "member"),
                ("beta", "alice", "owner"), ("beta", "departed", "member"),
                ("empty", "bob", "owner"),
            )
        ])
        sync.add_all([
            Folder(id="alice-folder", user_id="alice", name="private", hue="#000"),
            Folder(id="bob-folder", user_id="bob", name="private", hue="#000"),
        ])
        for sid, user, status in (
            ("shared", "alice", "active"), ("private", "alice", "active"),
            ("absorbed", "alice", "merged"), ("other-team", "alice", "active"),
            ("bob-private", "bob", "active"), ("bob-shared", "bob", "active"),
            ("departed-share", "departed", "active"), ("eve-private", "eve", "active"),
        ):
            sync.add(Session(
                id=sid, user_id=user, status=status, title=f"record-{sid}",
                summary={"overview": f"summary-{sid}"}, summary_status="done",
                folder_id=f"{user}-folder",
            ))
            sync.add(ExplorationEvent(
                id=f"event-{sid}", user_id=user, title=f"record-{sid}",
                url=f"https://example.test/{sid}", normalized_url=f"https://example.test/{sid}",
                visited_at=datetime.now(timezone.utc), content_excerpt=f"excerpt-{sid}",
                sync_status="processed",
            ))
        sync.flush()
        for sid in ("shared", "private", "absorbed", "other-team", "bob-private",
                    "bob-shared", "departed-share", "eve-private"):
            sync.add(SessionEvent(session_id=sid, event_id=f"event-{sid}", sequence_order=0))
            sync.add(SessionVersion(session_id=sid, version=1, title=f"version-{sid}"))
        sync.add_all([
            WorkspaceSession(workspace_id=team, session_id=sid, shared_by=user)
            for team, sid, user in (
                ("alpha", "shared", "alice"), ("alpha", "absorbed", "alice"),
                ("alpha", "bob-shared", "bob"), ("alpha", "departed-share", "departed"),
                ("beta", "shared", "alice"), ("beta", "other-team", "alice"),
            )
        ])
        for user in ("alice", "bob"):
            sync.add(ExplorationEvent(
                id=f"orphan-{user}", user_id=user, title="record-orphan",
                url="https://example.test/orphan", normalized_url="https://example.test/orphan",
                visited_at=datetime.now(timezone.utc), content_excerpt="excerpt-orphan",
            ))
        sync.commit()
        yield MemoryDB(sync)
    engine.dispose()


@pytest.fixture
def api(db, monkeypatch):
    app = FastAPI()
    for router in (workspaces.router, sessions.router, folders.router, search.router, ask.router):
        app.include_router(router)

    async def database():
        yield db

    async def user(request: Request):
        return request.headers.get("x-test-user", "bob")

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[current_user_id] = user

    async def embed(_text):
        return [0.1]

    async def vector_results(*args, **kwargs):
        # Deliberately ignore Qdrant's filter: SQL must remain the security boundary.
        return ["private", "bob-private", "absorbed", "other-team", "departed-share",
                "eve-private", "shared", "bob-shared"]

    async def scored_vector_results(*args, **kwargs):
        # Ask 후보 검색(candidate_floor) 경로. 마찬가지로 Qdrant 필터를 무시한다.
        return [(session_id, 0.9) for session_id in await vector_results()]

    async def score(_query, rows):
        # 임베딩 없이 모든 본문 조각을 근거로 둔다 — 범위 판정은 SQL만 한다.
        scored: dict[str, list] = {}
        for session_event, event in rows:
            scored.setdefault(session_event.session_id, []).append(
                (0.9, session_event.sequence_order, 0, event, event.content_excerpt or "")
            )
        return scored

    generated: list[str] = []
    verified: list[str] = []

    async def answer(_system, prompt):
        generated.append(prompt)
        yield prompt, "test-model"

    async def verify(prompt, _answer):
        verified.append(prompt)
        return []

    async def no_delete(_sid):
        pass

    monkeypatch.setattr(search, "embed", embed)
    monkeypatch.setattr(search, "search_similar", vector_results)
    monkeypatch.setattr(search, "search_similar_with_scores", scored_vector_results)
    monkeypatch.setattr(ask_service, "score_passages", score)
    monkeypatch.setattr(ask, "chat_completion_stream_with_meta", answer)
    monkeypatch.setattr(ask, "find_conflations", verify)
    monkeypatch.setattr(sessions, "delete_point", no_delete)

    def request(method, path, user="bob", **kwargs):
        async def send():
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as client:
                headers = {"x-test-user": user, **kwargs.pop("headers", {})}
                return await client.request(method, path, headers=headers, **kwargs)
        return asyncio.run(send())

    yield request

    # 답변 뒤 검증기도 생성과 같은 범위의 프롬프트만 받아야 한다(품질 회의 2026-10-23-provider-gaps).
    assert verified == generated


@pytest.mark.parametrize("suffix", ["", "/events", "/versions"])
@pytest.mark.parametrize("user,sid,status", [
    ("bob", "shared", 200), ("bob", "bob-private", 200),
    ("alice", "absorbed", 200), ("bob", "private", 404),
    ("bob", "absorbed", 404), ("bob", "other-team", 404),
    ("bob", "departed-share", 404), ("eve", "shared", 404),
    ("bob", "missing", 404),
])
def test_session_read_matrix(api, suffix, user, sid, status):
    response = api("GET", f"/sessions/{sid}{suffix}", user=user)
    assert response.status_code == status, response.text
    if status == 200 and suffix == "/events":
        assert [row["event_id"] for row in response.json()] == [f"event-{sid}"]
    if status == 200 and suffix == "/versions":
        assert [row["title"] for row in response.json()] == [f"version-{sid}"]


@pytest.mark.parametrize("method,path,body", [
    ("PATCH", "/sessions/shared", {"alias": "changed"}),
    ("DELETE", "/sessions/shared", None),
    ("POST", "/sessions/shared/retry-summary", None),
    ("POST", "/sessions/shared/merge", {"absorbed_id": "bob-private"}),
    ("POST", "/sessions/bob-private/merge", {"absorbed_id": "shared"}),
    ("POST", "/sessions/shared/unmerge", {"absorbed_id": "absorbed"}),
    ("DELETE", "/folders/alice-folder/sessions/shared", None),
    ("DELETE", "/folders/bob-folder/sessions/shared", None),
])
def test_shared_read_permission_never_grants_write(api, db, method, path, body):
    response = api(method, path, json=body)
    assert response.status_code == 404, response.text
    original = db.sync.get(Session, "shared")
    assert (original.alias, original.status, original.folder_id, original.summary_status) == (
        None, "active", "alice-folder", "done",
    )


def test_folder_assignment_filters_shared_sessions_in_sql(api, db):
    response = api("POST", "/folders/bob-folder/sessions", json={
        "session_ids": ["shared", "bob-private", "missing"],
    })
    assert response.json() == {
        "folder_id": "bob-folder", "assigned": ["bob-private"], "skipped": ["shared", "missing"],
    }
    assert db.sync.get(Session, "shared").folder_id == "alice-folder"


def test_share_request_filters_ownership_and_absorbed_sessions_in_sql(api):
    response = api("POST", "/workspaces/alpha/sessions", user="alice", json={
        "session_ids": ["private", "shared", "bob-private", "absorbed", "missing", "private"],
    })
    assert response.json() == {
        "workspace_id": "alpha", "shared": ["private", "shared"],
        "skipped": ["bob-private", "absorbed", "missing"],
    }


@pytest.mark.parametrize("scope", ["sessions", "memory"])
def test_team_search_executes_shared_sql_despite_unfiltered_vector_results(api, scope):
    response = api("GET", f"/search?q=record&scope={scope}&limit=20&workspace_id=alpha")
    assert response.status_code == 200
    rows = response.json() if scope == "sessions" else response.json()["sessions"]
    assert {row["session_id"] for row in rows} == {"shared", "bob-shared"}
    assert all(row["folder_id"] is None and row["shared_workspace_ids"] == [] for row in rows)
    if scope == "memory":
        assert {row["event_id"] for row in response.json()["events"]} == {
            "event-shared", "event-bob-shared",
        }


def test_keyword_sql_excludes_unshared_and_unassigned_events(db):
    rows = asyncio.run(search._fetch_keyword_matched_events(db, "record", set(), "bob", "alpha"))
    assert {row["event_id"] for row in rows} == {"event-shared", "event-bob-shared"}


def test_ask_context_sql_rechecks_team_scope(db):
    models, rows = asyncio.run(ask_service._load_context_records(
        db, ["shared", "private", "bob-private", "other-team"], "bob", "alpha",
    ))
    assert set(models) == {"shared"}
    assert [event.id for _, event in rows] == ["event-shared"]


@pytest.mark.parametrize("sid", [None, "shared", "private", "bob-private", "absorbed"])
def test_team_ask_sources_and_prompt_stay_in_scope(api, sid):
    response = api("POST", "/ask/stream", json={
        "query": "record", "workspace_id": "alpha", "session_id": sid, "rerank": False,
    })
    if sid in {"private", "bob-private", "absorbed"}:
        assert response.status_code == 404
        return
    assert response.status_code == 200
    assert "excerpt-shared" in response.text
    for forbidden in ("summary-private", "summary-bob-private", "summary-absorbed",
                      "summary-other-team", "summary-departed-share", "summary-eve-private",
                      "excerpt-orphan", "alice-folder", '"shared_workspace_ids":["alpha"'):
        assert forbidden not in response.text


def test_empty_team_search_and_ask_do_not_fall_back_to_personal(api):
    response = api("GET", "/search?q=record&scope=memory&workspace_id=empty")
    assert response.json() == {"sessions": [], "events": []}
    response = api("POST", "/ask/stream", json={"query": "record", "workspace_id": "empty"})
    assert response.status_code == 200
    assert '"sessions":[]' in response.text
    assert "excerpt-" not in response.text


@pytest.mark.parametrize("endpoint", ["search", "ask"])
def test_revocation_during_embedding_excludes_departed_sharers_records(api, db, monkeypatch, endpoint):
    async def revoke_before_retrieval(_query):
        await workspaces.remove_member("alpha", "bob", db, "alice")
        return [0.1]

    monkeypatch.setattr(search, "embed", revoke_before_retrieval)
    if endpoint == "search":
        response = api("GET", "/search?q=record&scope=memory&workspace_id=alpha", user="alice")
    else:
        response = api("POST", "/ask/stream", user="alice", json={
            "query": "record", "workspace_id": "alpha", "rerank": False,
        })
    assert response.status_code == 200
    assert db.sync.get(WorkspaceMember, ("alpha", "bob")) is None
    assert "bob-shared" not in response.text


@pytest.mark.parametrize("endpoint", ["sessions", "memory", "keyword", "ask", "find_sessions"])
@pytest.mark.parametrize("revocation", ["viewer", "unshare", "sharer_membership", "merged", "leave"])
def test_team_scope_rechecks_access_after_embedding(api, db, monkeypatch, endpoint, revocation):
    async def revoke_before_retrieval(_query):
        if revocation == "viewer":
            await workspaces.remove_member("alpha", "bob", db, "alice")
        elif revocation == "unshare":
            await workspaces.unshare_session("alpha", "bob-shared", db, "bob")
        elif revocation == "sharer_membership":
            # A concurrent share can leave a row behind after the sharer leaves.
            db.sync.delete(db.sync.get(WorkspaceMember, ("alpha", "bob")))
            db.sync.commit()
        elif revocation == "merged":
            db.sync.get(Session, "bob-shared").status = "merged"
            db.sync.commit()
        else:
            await workspaces.remove_member("alpha", "bob", db, "bob")
        return [0.1]

    async def no_vector_matches(*args, **kwargs):
        return []

    monkeypatch.setattr(search, "embed", revoke_before_retrieval)
    if endpoint == "keyword":
        monkeypatch.setattr(search, "search_similar", no_vector_matches)
        monkeypatch.setattr(search, "search_similar_with_scores", no_vector_matches)
    user = "bob" if revocation == "viewer" else "alice"
    if endpoint in {"ask", "find_sessions"}:
        response = api("POST", "/ask/stream", user=user, json={
            "query": "record", "workspace_id": "alpha", "rerank": False,
            "intent": "find_sessions" if endpoint == "find_sessions" else "search_memory",
        })
    else:
        scope = "sessions" if endpoint == "sessions" else "memory"
        response = api("GET", f"/search?q=record&scope={scope}&workspace_id=alpha", user=user)
    assert response.status_code == 200
    assert "bob-shared" not in response.text
    if revocation == "viewer":
        assert "record-shared" not in response.text
        assert "summary-shared" not in response.text
        assert "event-shared" not in response.text
    else:
        assert "record-shared" in response.text


def test_team_explicit_ask_rechecks_access_after_admission(api, db, monkeypatch):
    original = ask.team_shared_ids

    async def unshare_after_admission(database, user, workspace):
        ids = await original(database, user, workspace)
        await workspaces.unshare_session("alpha", "bob-shared", db, "bob")
        return ids

    monkeypatch.setattr(ask, "team_shared_ids", unshare_after_admission)
    response = api("POST", "/ask/stream", user="alice", json={
        "query": "record", "workspace_id": "alpha", "session_id": "bob-shared",
    })
    assert response.status_code == 404
    assert "bob-shared" not in response.text


@pytest.mark.parametrize("intent", ["search_memory", "find_sessions"])
def test_team_ask_drops_sources_revoked_before_context_load(api, db, monkeypatch, intent):
    original = ask._resolve_sources

    async def unshare_after_resolution(*args, **kwargs):
        sources = await original(*args, **kwargs)
        await workspaces.unshare_session("alpha", "bob-shared", db, "bob")
        return sources

    monkeypatch.setattr(ask, "_resolve_sources", unshare_after_resolution)
    response = api("POST", "/ask/stream", user="alice", json={
        "query": "record", "workspace_id": "alpha", "session_id": "bob-shared", "intent": intent,
    })
    assert response.status_code == 200
    assert '"sessions":[]' in response.text
    assert "bob-shared" not in response.text


def test_team_search_relevance_events_recheck_access_after_reranking(api, db, monkeypatch):
    async def unshare_during_rerank(_query, candidates):
        await workspaces.unshare_session("alpha", "bob-shared", db, "bob")
        return candidates

    monkeypatch.setattr(search, "llm_rerank", unshare_during_rerank)
    response = api(
        "GET", "/search?q=record&scope=memory&workspace_id=alpha&rerank=true", user="alice",
    )
    assert response.status_code == 200
    assert {row["event_id"] for row in response.json()["events"]} == {"event-shared"}


_TEAM_ACTIONS = [
    ("PATCH", "/workspaces/{team}", {"name": "renamed"}),
    ("DELETE", "/workspaces/{team}", None),
    ("POST", "/workspaces/{team}/invite-code", None),
    ("GET", "/workspaces/{team}/members", None),
    ("DELETE", "/workspaces/{team}/members/bob", None),
    ("GET", "/workspaces/{team}/sessions", None),
    ("POST", "/workspaces/{team}/sessions", {"session_ids": ["shared"]}),
    ("DELETE", "/workspaces/{team}/sessions/shared", None),
    ("GET", "/search?q=record&workspace_id={team}", None),
    ("POST", "/ask/stream", {"query": "record", "workspace_id": "{team}"}),
]


@pytest.mark.parametrize("method,path,body", _TEAM_ACTIONS)
def test_nonmember_cannot_distinguish_existing_team_from_missing(api, method, path, body):
    results = []
    for team in ("alpha", "missing"):
        payload = {key: value.replace("{team}", team) if isinstance(value, str) else value
                   for key, value in body.items()} if body else None
        response = api(method, path.format(team=team), user="eve", json=payload)
        assert response.status_code == 404, response.text
        results.append(response.json())
    assert results[0] == results[1]


@pytest.mark.parametrize("method,path,body", _TEAM_ACTIONS[:3])
def test_member_owner_actions_are_403(api, method, path, body):
    assert api(method, path.format(team="alpha"), json=body).status_code == 403


def test_owner_leave_is_409_and_preserves_team(api, db):
    assert api("DELETE", "/workspaces/alpha/members/alice", user="alice").status_code == 409
    assert db.sync.get(WorkspaceMember, ("alpha", "alice")) is not None


@pytest.mark.parametrize("actor", ["alice", "bob"])
def test_leave_or_kick_revokes_share_and_keeps_personal_record(api, db, actor):
    assert api("DELETE", "/workspaces/alpha/members/bob", user=actor).status_code == 204
    assert db.sync.get(WorkspaceSession, ("alpha", "bob-shared")) is None
    assert api("GET", "/sessions/bob-shared", user="alice").status_code == 404
    assert api("GET", "/sessions/bob-shared", user="bob").status_code == 200


@pytest.mark.parametrize("actor", ["alice", "bob"])
def test_left_or_kicked_member_loses_team_reads_immediately(api, actor):
    # The new-tab workspace menu reads these right after leave/kick; none may answer as a member.
    assert api("DELETE", "/workspaces/alpha/members/bob", user=actor).status_code == 204
    assert all(workspace["workspace_id"] != "alpha" for workspace in api("GET", "/workspaces").json())
    for method, path, body in _TEAM_ACTIONS:
        payload = {key: value.replace("{team}", "alpha") if isinstance(value, str) else value
                   for key, value in body.items()} if body else None
        response = api(method, path.format(team="alpha"), json=payload)
        assert response.status_code == 404, (method, path, response.text)


@pytest.mark.parametrize("actor", ["alice", "bob"])
@pytest.mark.parametrize("suffix", ["", "/events", "/versions"])
def test_left_or_kicked_member_cannot_read_teammate_session_by_id(api, actor, suffix):
    # Baseline proves the 404 below is the revoked membership, not a missing route.
    assert api("GET", f"/sessions/shared{suffix}").status_code == 200
    assert api("DELETE", "/workspaces/alpha/members/bob", user=actor).status_code == 204
    assert api("GET", f"/sessions/shared{suffix}").status_code == 404


def test_former_member_cannot_read_deleted_team(api):
    assert api("GET", "/workspaces/alpha/sessions").status_code == 200
    assert api("GET", "/sessions/shared").status_code == 200
    assert api("DELETE", "/workspaces/alpha", user="alice").status_code in (200, 204)
    assert all(workspace["workspace_id"] != "alpha" for workspace in api("GET", "/workspaces").json())
    assert api("GET", "/workspaces/alpha/sessions").status_code == 404
    for suffix in ("", "/events", "/versions"):
        assert api("GET", f"/sessions/shared{suffix}").status_code == 404
    assert api("POST", "/ask/stream", json={"query": "record", "workspace_id": "alpha"}).status_code == 404
    # The owner keeps the session in their personal record.
    assert api("GET", "/sessions/shared", user="alice").status_code == 200


def test_share_admitted_before_leave_but_committed_after_is_invisible(api, db, monkeypatch):
    original_member_check = workspaces._member_or_404

    async def leave_after_admission(database, team, user):
        member = await original_member_check(database, team, user)
        # Deterministic interleaving: share checked membership; leave commits;
        # the already-admitted share then resumes and inserts its row.
        await workspaces.remove_member(team, user, database, user)
        return member

    with monkeypatch.context() as patch:
        patch.setattr(workspaces, "_member_or_404", leave_after_admission)
        # remove_member uses the same guard; bypass only its nested call.
        async def once(database, team, user):
            patch.setattr(workspaces, "_member_or_404", original_member_check)
            return await leave_after_admission(database, team, user)
        patch.setattr(workspaces, "_member_or_404", once)
        response = api("POST", "/workspaces/alpha/sessions", json={"session_ids": ["bob-private"]})
    assert response.status_code == 200
    assert db.sync.get(WorkspaceSession, ("alpha", "bob-private")) is not None
    assert db.sync.get(WorkspaceMember, ("alpha", "bob")) is None
    assert asyncio.run(workspace_service.shared_session_ids(db, "alpha")) == ["shared"]
    assert {row["session_id"] for row in api("GET", "/workspaces/alpha/sessions", user="alice").json()} == {"shared"}
    for suffix in ("", "/events", "/versions"):
        assert api("GET", f"/sessions/bob-private{suffix}", user="alice").status_code == 404
    response = api("GET", "/search?q=record&scope=memory&workspace_id=alpha", user="alice")
    assert {row["session_id"] for row in response.json()["sessions"]} == {"shared"}
    response = api("POST", "/ask/stream", user="alice", json={
        "query": "record", "workspace_id": "alpha", "rerank": False,
    })
    assert "bob-private" not in response.text


def test_invite_hash_rotation_expiration_and_kick_have_same_failure(api, db):
    issued = api("POST", "/workspaces/alpha/invite-code", user="alice").json()
    code = issued["code"]
    workspace = db.sync.get(Workspace, "alpha")
    assert workspace.invite_code_hash == hashlib.sha256(code.encode()).hexdigest()
    assert code not in str(db.sync.execute(select(Workspace.__table__)).all())
    assert api("POST", "/workspaces/join", user="eve", json={"code": code}).status_code == 200
    new_code = api("POST", "/workspaces/alpha/invite-code", user="alice").json()["code"]
    invalid = [api("POST", "/workspaces/join", json={"code": value}) for value in ("unknown", code)]
    workspace.invite_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.sync.commit()
    invalid.append(api("POST", "/workspaces/join", json={"code": new_code}))
    kick_code = api("POST", "/workspaces/alpha/invite-code", user="alice").json()["code"]
    assert api("DELETE", "/workspaces/alpha/members/eve", user="alice").status_code == 204
    invalid.append(api("POST", "/workspaces/join", user="eve", json={"code": kick_code}))
    assert [response.status_code for response in invalid] == [400, 400, 400, 400]
    assert [response.json() for response in invalid] == [
        {"detail": "유효하지 않거나 만료된 초대 코드입니다"},
        {"detail": "유효하지 않거나 만료된 초대 코드입니다"},
        {"detail": "유효하지 않거나 만료된 초대 코드입니다"},
        {"detail": "유효하지 않거나 만료된 초대 코드입니다"},
    ]


def test_member_responses_hide_private_metadata_and_other_emails(api):
    detail = api("GET", "/sessions/shared").json()
    assert (detail["folder_id"], detail["shared_workspace_ids"]) == (None, [])
    rows = api("GET", "/workspaces/alpha/sessions").json()
    assert all(row["folder_id"] is None and row["shared_workspace_ids"] == [] for row in rows)
    assert {row["user_id"]: row["email"] for row in api("GET", "/workspaces/alpha/members").json()} == {
        "alice": None, "bob": "bob@example.test",
    }
    assert {row["user_id"]: row["email"] for row in api("GET", "/workspaces/alpha/members", user="alice").json()} == {
        "alice": "alice@example.test", "bob": "bob@example.test",
    }
    owner = api("GET", "/sessions/shared", user="alice").json()
    assert owner["folder_id"] == "alice-folder"
    assert set(owner["shared_workspace_ids"]) == {"alpha", "beta"}


def test_recommendation_candidates_and_cache_are_owner_scoped(db, monkeypatch):
    async def hostile_scores(_context, _user):
        return {"private": 1.0, "shared": 1.0, "eve-private": 1.0}

    monkeypatch.setattr(recommender, "_vector_scores", hostile_scores)
    signals = asyncio.run(recommender._collect_signals(db, "bob", RecommendationContext()))
    assert {item.session_id for item in signals} == {"bob-private", "bob-shared"}
    db.sync.add_all([
        RecommendationCache(user_id="alice", items=[{"session_id": "private"}]),
        RecommendationCache(user_id="bob", items=[{"session_id": "bob-private"}]),
    ])
    db.sync.commit()
    cached = asyncio.run(recommender._read_cache(db, "bob"))
    assert cached.items == [{"session_id": "bob-private"}]
