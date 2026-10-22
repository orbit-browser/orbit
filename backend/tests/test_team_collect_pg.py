"""팀 수집 모드 — 실제 PostgreSQL에서만 확인할 수 있는 경로(docs/team-collect-mode.md §6.4, §9.1).

인제스트 INSERT ON CONFLICT, 배치 반영의 재판정, 행 잠금 경합(FOR SHARE / FOR UPDATE)을 본다.
버리는 PostgreSQL을 ORBIT_TEST_PG_URL 로 준다(예: postgresql+asyncpg://collect:...@127.0.0.1:5603/orbit_collect_test).
비어 있는 DB에만 쓴다 — 표가 하나라도 있으면 실패한다. 끝나면 만든 표를 모두 지운다.
임베딩·Qdrant·LLM은 대역이며, Qdrant 대역은 스트림 필터를 일부러 무시한다(경계는 SQL이어야 한다).
"""

import asyncio
import os
import socket
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi import FastAPI, Request
from sqlalchemy import func, select, text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.api import events, team_collect, workspaces
from app.api.deps import current_user_id
from app.db.migrations import run_migrations
from app.db.models import (
    Base,
    ExplorationEvent,
    Session,
    SessionEvent,
    SyncBatch,
    User,
    Workspace,
    WorkspaceCollectWindow,
    WorkspaceMember,
    WorkspaceSession,
)
from app.db.session import get_db
from app.services import intent_analyzer, session_updater, sync_pipeline
from app.services import team_collect as collect
from app.services.intent_analyzer import Assignment

PG_URL = os.environ.get("ORBIT_TEST_PG_URL")
pytestmark = pytest.mark.skipif(not PG_URL, reason="ORBIT_TEST_PG_URL not set (disposable PostgreSQL)")

# conftest 가 시험마다 DB·네트워크 연결을 막는다. 이 파일은 지정한 PostgreSQL 포트 하나만 다시 연다.
_REAL_RAW_CONNECTION = Engine.raw_connection
_REAL_CONNECT = socket.socket.connect
_REAL_CONNECT_EX = socket.socket.connect_ex

T = "team"
DEVICE = "device-1"


def _now() -> datetime:
    return datetime.now(timezone.utc)


@pytest.fixture(scope="module")
def schema():
    engine = create_async_engine(PG_URL, poolclass=NullPool)

    async def setup():
        async with engine.begin() as conn:
            tables = await conn.scalar(text("SELECT count(*) FROM pg_tables WHERE schemaname = 'public'"))
            if tables:
                raise RuntimeError(f"test database is not empty ({tables} tables) — refusing to write")
            await conn.run_sync(Base.metadata.create_all)
        async with engine.begin() as conn:
            await run_migrations(conn)

    async def teardown():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        await engine.dispose()

    asyncio.run(setup())
    yield
    asyncio.run(teardown())


@pytest.fixture
def pg(schema, monkeypatch):
    port = make_url(PG_URL).port or 5432

    def allowed(address) -> bool:
        return isinstance(address, tuple) and len(address) >= 2 and address[1] == port

    def connect(sock, address):
        if sock.family in (socket.AF_INET, socket.AF_INET6) and not allowed(address):
            raise ConnectionRefusedError("only the test PostgreSQL port is allowed")
        return _REAL_CONNECT(sock, address)

    def connect_ex(sock, address):
        if sock.family in (socket.AF_INET, socket.AF_INET6) and not allowed(address):
            raise ConnectionRefusedError("only the test PostgreSQL port is allowed")
        return _REAL_CONNECT_EX(sock, address)

    monkeypatch.setattr(Engine, "raw_connection", _REAL_RAW_CONNECTION)
    monkeypatch.setattr(socket.socket, "connect", connect)
    monkeypatch.setattr(socket.socket, "connect_ex", connect_ex)

    # 보호 코드가 빠져 경합 시험이 실패해도 남은 잠금에 다음 시험이 영원히 걸리지 않게 한다.
    engine = create_async_engine(
        PG_URL, poolclass=NullPool, connect_args={"server_settings": {"lock_timeout": "15000"}}
    )
    maker = async_sessionmaker(engine, expire_on_commit=False)
    for module in (sync_pipeline, session_updater):
        monkeypatch.setattr(module, "AsyncSessionLocal", maker)

    async def reset():
        async with engine.begin() as conn:
            names = ", ".join(t.name for t in reversed(Base.metadata.sorted_tables))
            await conn.execute(text(f"TRUNCATE {names} CASCADE"))
        now = _now()
        async with maker() as db:
            db.add_all(User(id=u, google_sub=u, email=f"{u}@example.test", name=u) for u in ("olive", "mina", "eve"))
            db.add(Workspace(id=T, name=T, hue="#000", collect_allowed=True))
            await db.flush()
            db.add_all([
                WorkspaceMember(workspace_id=T, user_id="olive", role="owner", joined_at=now - timedelta(days=2)),
                WorkspaceMember(workspace_id=T, user_id="mina", role="member", joined_at=now - timedelta(days=1)),
            ])
            db.add(WorkspaceCollectWindow(
                id="w1", workspace_id=T, user_id="mina", device_id=DEVICE,
                started_at=now - timedelta(hours=2), expires_at=now + timedelta(hours=1),
            ))
            await db.commit()

    asyncio.run(reset())
    yield maker
    asyncio.run(engine.dispose())


# ── 도우미 ──────────────────────────────────────────────


def _app(maker):
    app = FastAPI()
    for router in (events.router, workspaces.router, team_collect.router):
        app.include_router(router)

    async def database():
        async with maker() as db:
            yield db

    async def user(request: Request):
        return request.headers["x-test-user"]

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[current_user_id] = user
    return app


@pytest.fixture
def api(pg, monkeypatch):
    app = _app(pg)

    async def nothing(*_args, **_kwargs):
        return None

    monkeypatch.setattr(events, "_trigger_batch_if_over_threshold", lambda _n: None)
    monkeypatch.setattr(workspaces, "set_stream_payload", nothing)
    monkeypatch.setattr(team_collect, "set_stream_payload", nothing)

    async def call(method, path, user="mina", **kwargs):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            return await client.request(method, path, headers={"x-test-user": user}, **kwargs)

    return call


def _wire(eid, *, url=None, ws=T, window="w1", minutes_ago=10):
    return {
        "id": eid, "url": url or f"https://example.test/{eid}", "title": f"title {eid}",
        "visited_at": (_now() - timedelta(minutes=minutes_ago)).isoformat(), "active_duration_ms": 60000,
        "workspace_id": ws, "collect_window_id": window,
    }


def _uuid(n: int) -> str:
    return f"00000000-0000-4000-8000-{n:012d}"


async def _label(maker, eid):
    async with maker() as db:
        event = await db.get(ExplorationEvent, eid)
        return (event.workspace_id, event.collect_window_id) if event else None


async def _add_events(maker, rows):
    async with maker() as db:
        db.add_all(rows)
        await db.commit()


def _pending(eid, user="mina", *, ws=T, window="w1", minutes_ago=10, url=None):
    url = url or f"https://example.test/{eid}"
    return ExplorationEvent(
        id=eid, user_id=user, url=url, normalized_url=url, title=f"title {eid}", domain="example.test",
        visited_at=_now() - timedelta(minutes=minutes_ago), active_duration_ms=120000, device_id=DEVICE,
        sync_status="pending", workspace_id=ws, collect_window_id=window,
    )


@pytest.fixture
def pipeline(pg, monkeypatch):
    """배치를 실제 SQL로 돌리고 외부 호출만 대역으로 바꾼다. analyze 와 Qdrant 후보는 시험이 정한다."""
    state = {"vector_ids": [], "analyze": None}

    async def embed_many(texts):
        return [[1.0, 0.0] for _ in texts]

    async def search(*_args, **_kwargs):
        return [(sid, 0.9) for sid in state["vector_ids"]]  # 스트림 필터를 무시한다

    async def score(_vector, ids, **_kwargs):
        return {sid: 0.9 for sid in ids}

    async def analyze(group, candidates):
        return await state["analyze"](group, candidates)

    async def nothing(*_args, **_kwargs):
        return None

    async def disabled(*_args, **_kwargs):
        return False

    monkeypatch.setattr(sync_pipeline, "embed_many", embed_many)
    monkeypatch.setattr(sync_pipeline, "subcluster", lambda emb, _t: [list(range(len(emb)))])
    monkeypatch.setattr(sync_pipeline, "split_noise", lambda group: (group, []))
    monkeypatch.setattr(sync_pipeline, "search_similar_with_scores", search)
    monkeypatch.setattr(sync_pipeline, "score_sessions", score)
    monkeypatch.setattr(intent_analyzer, "analyze", analyze)
    monkeypatch.setattr(sync_pipeline, "refresh_session_ai", nothing)
    monkeypatch.setattr(sync_pipeline, "invalidate_recommendations", nothing)
    monkeypatch.setattr(sync_pipeline, "is_auto_merge_enabled", disabled)
    monkeypatch.setattr(sync_pipeline, "is_auto_folder_enabled", disabled)

    async def run_once():
        batch_id = await sync_pipeline._create_batch_row("manual")
        claimed, user = await sync_pipeline._claim_pending_events(batch_id)
        if claimed:
            await sync_pipeline._process_batch(batch_id, claimed, user)
        async with pg() as db:
            batch = await db.get(SyncBatch, batch_id)
            assert batch.status == "completed", batch.error_message
        return claimed

    state["run_once"] = run_once
    return state


def _create_all(group, _candidates):
    return [Assignment(event_indices=list(range(len(group))), action="create", title="t", relevance=0.8)]


async def _sessions_of(maker, eid):
    async with maker() as db:
        return list((await db.execute(select(SessionEvent.session_id).where(SessionEvent.event_id == eid))).scalars())


# ── 인제스트(실제 INSERT ON CONFLICT) ──────────────────────────────


def test_ingest_end_to_end_labels_resend_and_withdraw(api, pg):
    """불변 조건 8·11·14: 판정 통과만 팀 표시. 재전송으로 표시를 바꿀 수 없고, 빼기만 바꾼다."""

    async def scenario():
        good, mail, late = _uuid(1), _uuid(2), _uuid(3)
        body = {"device_id": DEVICE, "events": [_wire(good), _wire(mail, url="https://mail.google.com/mail/u/0/")]}
        response = await api("POST", "/events", json=body)
        assert response.status_code == 202
        result = response.json()
        assert (result["team_accepted"], result["team_downgraded"], result["window_closed"]) == (1, 1, False)
        assert await _label(pg, good) == (T, "w1")
        assert await _label(pg, mail) == (None, None)

        # 응답을 잃어 개인으로 다시 보낸 재전송: 처음 저장한 팀 표시가 그대로다.
        resend = {"device_id": DEVICE, "events": [_wire(good, ws=None, window=None)]}
        assert (await api("POST", "/events", json=resend)).json()["duplicates"] == 1
        assert await _label(pg, good) == (T, "w1")

        withdrawn = await api("POST", f"/workspaces/{T}/collect/windows/w1/withdraw")
        assert withdrawn.json()["withdrawn_events"] == 1
        assert await _label(pg, good) == (None, None)

        after = await api("POST", "/events", json={"device_id": DEVICE, "events": [_wire(late, minutes_ago=1)]})
        assert after.json()["team_accepted"] == 0 and after.json()["window_closed"] is True
        assert await _label(pg, late) == (None, None)

    asyncio.run(scenario())


def test_ingest_after_stop_is_personal_but_late_arrivals_inside_window_stay(api, pg):
    """불변 조건 10·13(서버 쪽): 끈 뒤의 방문은 개인. 끄기 전(끝 5분 넘게 전) 방문이 늦게 와도 팀."""

    async def scenario():
        assert (await api("DELETE", f"/workspaces/{T}/collect?device_id={DEVICE}&reason=stop")).status_code == 204
        before, after = _uuid(11), _uuid(12)
        body = {"device_id": DEVICE, "events": [_wire(before, minutes_ago=30), _wire(after, minutes_ago=-1)]}
        result = (await api("POST", "/events", json=body)).json()
        assert result["team_accepted"] == 1 and result["window_closed"] is True
        assert await _label(pg, before) == (T, "w1")
        assert await _label(pg, after) == (None, None)

    asyncio.run(scenario())


def test_ingest_rejects_window_from_before_rejoin(api, pg):
    """불변 조건 15: 탈퇴 → 재가입 뒤 늦게 도착한 옛 창의 방문은 개인."""

    async def scenario():
        assert (await api("DELETE", f"/workspaces/{T}/members/mina")).status_code == 204
        async with pg() as db:
            db.add(WorkspaceMember(workspace_id=T, user_id="mina", role="member", joined_at=_now()))
            await db.commit()
        eid = _uuid(21)
        result = (await api("POST", "/events", json={"device_id": DEVICE, "events": [_wire(eid, minutes_ago=60)]})).json()
        assert result["team_accepted"] == 0
        assert await _label(pg, eid) == (None, None)

    asyncio.run(scenario())


# ── 잠금 경합 ──────────────────────────────────────────────


async def _ingest_uncommitted(maker, eid):
    """인제스트 트랜잭션을 판정·INSERT 까지 하고 커밋하지 않은 채 돌려준다."""
    db = maker()
    body = events.EventBatchRequest(device_id=DEVICE, events=[_wire(eid)])
    rows, _ = events._build_event_rows(body.events, body.device_id, "mina")
    judgement = await events._apply_team_labels(db, body.events, rows, "mina")
    assert judgement.labels == {eid: (T, "w1")}
    await db.execute(events.pg_insert(ExplorationEvent).values(rows))
    return db


def test_withdraw_waits_for_inflight_ingest_and_clears_its_label(pg):
    """불변 조건 14(경합): 빼기가 커밋 전 인제스트를 기다렸다가 그 팀 표시까지 비운다."""

    async def scenario():
        eid = _uuid(31)
        ingest = await _ingest_uncommitted(pg, eid)

        async def withdraw():
            async with pg() as db:
                count = await collect.withdraw(db, T, "mina", "w1", _now())
                await db.commit()
                return count

        task = asyncio.create_task(withdraw())
        try:
            await asyncio.sleep(0.5)
            assert not task.done(), "withdraw must wait for the ingest's FOR SHARE lock"
            await ingest.commit()
        finally:
            await ingest.close()
        assert await asyncio.wait_for(task, 20) == 1
        assert await _label(pg, eid) == (None, None)

    asyncio.run(scenario())


def test_leave_waits_for_inflight_ingest_and_clears_its_label(pg):
    """S'2: 탈퇴 정리는 창을 먼저 잠가, 진행 중인 인제스트가 막 저장한 팀 표시도 비운다."""

    async def scenario():
        eid = _uuid(41)
        ingest = await _ingest_uncommitted(pg, eid)

        async def leave():
            async with pg() as db:
                await collect.release_stream(db, T, "mina", "left", _now())
                await db.execute(WorkspaceMember.__table__.delete().where(WorkspaceMember.user_id == "mina"))
                await db.commit()

        task = asyncio.create_task(leave())
        try:
            await asyncio.sleep(0.5)
            assert not task.done(), "leave must lock collect windows first"
            await ingest.commit()
        finally:
            await ingest.close()
        await asyncio.wait_for(task, 20)
        assert await _label(pg, eid) == (None, None)

    asyncio.run(scenario())


def test_ingest_after_concurrent_withdraw_sees_it(pg):
    """빼기가 먼저 잠그면 그 뒤의 인제스트는 기다렸다가 빼진 창을 보고 개인으로 저장한다."""

    async def scenario():
        holder = pg()
        await collect.withdraw(holder, T, "mina", "w1", _now())  # 잠근 채 커밋하지 않는다

        async def ingest():
            db = pg()
            body = events.EventBatchRequest(device_id=DEVICE, events=[_wire(_uuid(51))])
            rows, _ = events._build_event_rows(body.events, body.device_id, "mina")
            judgement = await events._apply_team_labels(db, body.events, rows, "mina")
            await db.rollback()
            await db.close()
            return judgement

        task = asyncio.create_task(ingest())
        try:
            await asyncio.sleep(0.5)
            assert not task.done()
            await holder.commit()
        finally:
            await holder.close()
        assert (await asyncio.wait_for(task, 20)).labels == {}

    asyncio.run(scenario())


def test_concurrent_starts_leave_one_open_window(pg):
    """S2: 같은 기기의 시작 요청이 겹쳐도 열린 창은 하나다(부분 유니크 인덱스)."""

    async def scenario():
        async with pg() as db:
            await collect.close_windows(db, "stop", _now(), WorkspaceCollectWindow.user_id == "mina")
            await db.commit()
        first, second = pg(), pg()
        await collect.start_window(first, T, "mina", "device-2", 60, _now())

        async def start_second():
            try:
                await collect.start_window(second, T, "mina", "device-2", 60, _now())
                await second.commit()
                return "committed"
            except IntegrityError:
                await second.rollback()
                return "conflict"
            finally:
                await second.close()

        task = asyncio.create_task(start_second())
        try:
            await asyncio.sleep(0.5)
            await first.commit()
        finally:
            await first.close()
        assert await asyncio.wait_for(task, 20) == "conflict"
        async with pg() as db:
            open_count = await db.scalar(
                select(func.count()).select_from(WorkspaceCollectWindow).where(
                    WorkspaceCollectWindow.device_id == "device-2", WorkspaceCollectWindow.ended_at.is_(None)
                )
            )
        assert open_count == 1

    asyncio.run(scenario())


# ── 배치 스트림 ──────────────────────────────────────────────


def test_batch_creates_team_session_and_shares_it(pg, pipeline):
    async def scenario():
        await _add_events(pg, [_pending("t1"), _pending("t2", minutes_ago=9)])
        pipeline["analyze"] = lambda g, c: asyncio.sleep(0, _create_all(g, c))
        await pipeline["run_once"]()
        [sid] = await _sessions_of(pg, "t1")
        async with pg() as db:
            session = await db.get(Session, sid)
            assert session.collect_workspace_id == T and session.user_id == "mina"
            assert await db.get(WorkspaceSession, (T, sid)) is not None

    asyncio.run(scenario())


def test_claim_takes_one_stream_at_a_time(pg, pipeline):
    """불변 조건 9: 같은 사람의 개인·팀 방문은 한 배치에 섞이지 않는다."""

    async def scenario():
        await _add_events(pg, [_pending("team-old", minutes_ago=20), _pending("mine", ws=None, window=None, minutes_ago=15)])
        pipeline["analyze"] = lambda g, c: asyncio.sleep(0, _create_all(g, c))
        first = await pipeline["run_once"]()
        assert [e["id"] for e in first] == ["team-old"]
        second = await pipeline["run_once"]()
        assert [e["id"] for e in second] == ["mine"]
        [personal] = await _sessions_of(pg, "mine")
        async with pg() as db:
            assert (await db.get(Session, personal)).collect_workspace_id is None
            assert await db.get(WorkspaceSession, (T, personal)) is None

    asyncio.run(scenario())


async def _make_session(maker, sid, *, stream):
    async with maker() as db:
        db.add(Session(
            id=sid, user_id="mina", title=sid, summary={}, origin="events", status="active",
            last_activity_at=_now() - timedelta(minutes=30), collect_workspace_id=stream,
        ))
        if stream:
            await db.flush()
            db.add(WorkspaceSession(workspace_id=stream, session_id=sid, shared_by="mina"))
        await db.commit()


def test_personal_batch_never_appends_to_team_session(pg, pipeline):
    """불변 조건 9: Qdrant 가 팀 세션을 후보로 내도 SQL 후보 조건이 거르고, LLM 이 그 세션을 지목해도 붙지 않는다."""

    async def scenario():
        await _make_session(pg, "team-session", stream=T)
        await _add_events(pg, [_pending("mine", ws=None, window=None)])
        pipeline["vector_ids"] = ["team-session"]
        seen = {}

        async def analyze(group, candidates):
            seen["candidates"] = [c["session_id"] for c in candidates]
            return [Assignment(event_indices=[0], action="append", target="team-session", relevance=0.9)]

        pipeline["analyze"] = analyze
        await pipeline["run_once"]()
        assert seen["candidates"] == []
        assert "team-session" not in await _sessions_of(pg, "mine")

    asyncio.run(scenario())


def test_append_target_switched_stream_after_llm_creates_separately(pg, pipeline):
    """§6.4 ②: 후보를 고른 뒤 대상 세션의 스트림이 바뀌면(되돌리기 등) append 대신 새 세션."""

    async def scenario():
        await _make_session(pg, "was-personal", stream=None)
        await _add_events(pg, [_pending("mine", ws=None, window=None)])
        pipeline["vector_ids"] = ["was-personal"]

        async def analyze(group, candidates):
            assert [c["session_id"] for c in candidates] == ["was-personal"]
            async with pg() as db:  # LLM 대기 중 그 세션이 팀 스트림이 된다
                (await db.get(Session, "was-personal")).collect_workspace_id = T
                await db.commit()
            return [Assignment(event_indices=[0], action="append", target="was-personal", relevance=0.9)]

        pipeline["analyze"] = analyze
        await pipeline["run_once"]()
        [sid] = await _sessions_of(pg, "mine")
        assert sid != "was-personal"

    asyncio.run(scenario())


@pytest.mark.parametrize("change", ["leave", "withdraw", "rejoin"])
def test_team_group_turns_personal_when_permission_changes_during_llm(pg, pipeline, change):
    """불변 조건 5·14·15(§6.4 ①③): LLM 대기 중 탈퇴·빼기·재가입이 일어나면 그룹 전체를 개인으로 반영한다."""

    async def scenario():
        await _add_events(pg, [_pending("t1")])

        async def analyze(group, candidates):
            async with pg() as db:
                if change == "withdraw":
                    await db.execute(
                        ExplorationEvent.__table__.update()
                        .where(ExplorationEvent.id == "t1")
                        .values(workspace_id=None, collect_window_id=None)
                    )
                else:
                    await db.execute(
                        WorkspaceMember.__table__.delete().where(WorkspaceMember.user_id == "mina")
                    )
                    if change == "rejoin":
                        db.add(WorkspaceMember(workspace_id=T, user_id="mina", role="member", joined_at=_now()))
                await db.commit()
            return _create_all(group, candidates)

        pipeline["analyze"] = analyze
        await pipeline["run_once"]()
        [sid] = await _sessions_of(pg, "t1")
        async with pg() as db:
            assert (await db.get(Session, sid)).collect_workspace_id is None
            assert await db.get(WorkspaceSession, (T, sid)) is None
        assert await _label(pg, "t1") == (None, None)

    asyncio.run(scenario())


def test_withdraw_restore_then_personal_visit_never_joins_team_session(pg, pipeline, api):
    """불변 조건 16(N1): 빼기 → 되돌리기 → (수집을 끈 채) 개인 방문 → 배치 뒤에도 그 세션에 개인 방문이 없다."""

    async def scenario():
        await _add_events(pg, [_pending("t1")])
        pipeline["analyze"] = lambda g, c: asyncio.sleep(0, _create_all(g, c))
        await pipeline["run_once"]()
        [sid] = await _sessions_of(pg, "t1")

        assert (await api("DELETE", f"/workspaces/{T}/sessions/{sid}")).status_code == 204
        assert (await api("POST", f"/workspaces/{T}/collect/sessions/{sid}/restore")).status_code == 204
        assert (await api("DELETE", f"/workspaces/{T}/collect?reason=stop")).status_code == 204

        await _add_events(pg, [_pending("mine", ws=None, window=None, minutes_ago=1)])
        pipeline["vector_ids"] = [sid]

        async def analyze(group, candidates):
            return [Assignment(event_indices=[0], action="append", target=sid, relevance=0.9)]

        pipeline["analyze"] = analyze
        await pipeline["run_once"]()
        assert sid not in await _sessions_of(pg, "mine")
        async with pg() as db:
            assert (await db.get(Session, sid)).collect_workspace_id == T
            assert await db.get(WorkspaceSession, (T, sid)) is not None

    asyncio.run(scenario())


def test_migrations_are_idempotent_on_postgres(pg):
    async def scenario():
        engine = create_async_engine(PG_URL, poolclass=NullPool)
        async with engine.begin() as conn:
            await run_migrations(conn)
            await run_migrations(conn)
            names = set(
                (await conn.execute(text("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'"))).scalars()
            )
        await engine.dispose()
        assert {
            "ix_exploration_events_stream",
            "ix_exploration_events_collect_window",
            "ix_sessions_collect_workspace_id",
            "ux_collect_windows_open",
        } <= names

    asyncio.run(scenario())


def test_restore_waits_for_leave_and_then_refuses(pg, pipeline):
    """되돌리기는 창 → 세션 순서로 잠근다. 진행 중인 탈퇴 정리를 기다렸다가(교착 없이) 409로 끝난다."""

    async def scenario():
        await _add_events(pg, [_pending("t1")])
        pipeline["analyze"] = lambda g, c: asyncio.sleep(0, _create_all(g, c))
        await pipeline["run_once"]()
        [sid] = await _sessions_of(pg, "t1")
        async with pg() as db:  # 돌아보기에서 뺀 상태
            await db.execute(WorkspaceSession.__table__.delete().where(WorkspaceSession.session_id == sid))
            (await db.get(Session, sid)).collect_workspace_id = None
            await db.commit()

        leaving = pg()
        await collect.release_stream(leaving, T, "mina", "left", _now())
        await leaving.execute(WorkspaceMember.__table__.delete().where(WorkspaceMember.user_id == "mina"))

        async def restore():
            async with pg() as db:
                try:
                    await collect.restore(db, T, "mina", sid)
                    await db.commit()
                    return "restored"
                except collect.CollectError as exc:
                    return exc.code

        task = asyncio.create_task(restore())
        try:
            await asyncio.sleep(0.5)
            assert not task.done(), "restore must wait on the collect window lock"
            await leaving.commit()
        finally:
            await leaving.close()
        assert await asyncio.wait_for(task, 20) == "conflict"
        async with pg() as db:
            assert await db.get(WorkspaceSession, (T, sid)) is None

    asyncio.run(scenario())


def test_leave_waits_for_late_ingest_into_an_ended_window(pg):
    """S'2: 이미 끝난 창으로 늦게 도착한 방문을 저장 중이어도, 탈퇴 정리는 그 창을 FOR UPDATE 로 잡아 기다린다.

    끝난 창은 정리에서 고쳐 쓰지 않으므로 행 갱신의 암묵 잠금이 없다 — 명시적 잠금만이 이 경합을 막는다.
    """

    async def scenario():
        async with pg() as db:
            window = await db.get(WorkspaceCollectWindow, "w1")
            window.ended_at, window.ended_reason = _now() - timedelta(minutes=30), "stop"
            await db.commit()
        eid = _uuid(61)
        ingest = pg()
        body = events.EventBatchRequest(device_id=DEVICE, events=[_wire(eid, minutes_ago=50)])
        rows, _ = events._build_event_rows(body.events, body.device_id, "mina")
        assert (await events._apply_team_labels(ingest, body.events, rows, "mina")).labels == {eid: (T, "w1")}
        await ingest.execute(events.pg_insert(ExplorationEvent).values(rows))

        async def leave():
            async with pg() as db:
                await collect.release_stream(db, T, "mina", "left", _now())
                await db.commit()

        task = asyncio.create_task(leave())
        try:
            await asyncio.sleep(0.5)
            assert not task.done(), "leave must lock ended windows too"
            await ingest.commit()
        finally:
            await ingest.close()
        await asyncio.wait_for(task, 20)
        assert await _label(pg, eid) == (None, None)

    asyncio.run(scenario())


def _pause_after_confirm(monkeypatch):
    """반영 트랜잭션이 재판정(창 FOR SHARE)을 지난 뒤, 세션을 쓰기 전에 멈추게 한다."""
    reached, release = asyncio.Event(), asyncio.Event()
    real = session_updater.confirm_team_events

    async def paused(*args, **kwargs):
        result = await real(*args, **kwargs)
        reached.set()
        await release.wait()
        return result

    monkeypatch.setattr(session_updater, "confirm_team_events", paused)
    return reached, release


def test_leave_during_apply_waits_and_leaves_no_stale_share(pg, pipeline, api, monkeypatch):
    """R1: 반영이 재판정을 지난 뒤 탈퇴가 시작돼도, 탈퇴는 창 잠금을 기다렸다가 반영이 만든 공유·스트림까지 지운다.

    잠금이 없으면 탈퇴가 먼저 커밋되고 반영이 낡은 판정으로 공유 행을 만든다 — 재가입하면 옛 세션이 팀에 다시 보인다.
    """

    async def scenario():
        await _add_events(pg, [_pending("t1")])
        pipeline["analyze"] = lambda g, c: asyncio.sleep(0, _create_all(g, c))
        reached, release = _pause_after_confirm(monkeypatch)
        batch = asyncio.create_task(pipeline["run_once"]())
        await asyncio.wait_for(reached.wait(), 20)

        leave = asyncio.create_task(api("DELETE", f"/workspaces/{T}/members/mina"))
        await asyncio.sleep(0.5)
        release.set()
        await asyncio.wait_for(batch, 30)
        assert (await asyncio.wait_for(leave, 30)).status_code == 204

        [sid] = await _sessions_of(pg, "t1")
        async with pg() as db:
            assert await db.get(WorkspaceSession, (T, sid)) is None
            assert (await db.get(Session, sid)).collect_workspace_id is None
            db.add(WorkspaceMember(workspace_id=T, user_id="mina", role="member", joined_at=_now()))
            await db.commit()
        assert (await api("GET", f"/workspaces/{T}/sessions", user="olive")).json() == []

    asyncio.run(scenario())


def test_withdraw_during_apply_waits_and_reports_the_new_session(pg, pipeline, api, monkeypatch):
    """R1: 반영 도중 빼기는 창 잠금을 기다린다. 반영이 만든 팀 세션은 빼기 응답에 나와 세션별로 뺄 수 있고,
    팀 세션 안에 빼진(표시 없는) 방문이 섞이지 않는다.

    잠금이 없으면 빼기가 먼저 방문 표시를 지우고, 반영은 낡은 판정으로 그 방문을 팀 세션에 넣는다 — 그 세션은
    창 id 로 찾을 수 없어 돌아보기에도 나오지 않는다.
    """

    async def scenario():
        await _add_events(pg, [_pending("t1")])
        pipeline["analyze"] = lambda g, c: asyncio.sleep(0, _create_all(g, c))
        reached, release = _pause_after_confirm(monkeypatch)
        batch = asyncio.create_task(pipeline["run_once"]())
        await asyncio.wait_for(reached.wait(), 20)

        withdraw = asyncio.create_task(api("POST", f"/workspaces/{T}/collect/windows/w1/withdraw"))
        await asyncio.sleep(0.5)
        release.set()
        await asyncio.wait_for(batch, 30)
        body = (await asyncio.wait_for(withdraw, 30)).json()

        [sid] = await _sessions_of(pg, "t1")
        async with pg() as db:
            session = await db.get(Session, sid)
            if session.collect_workspace_id is not None:
                assert await _label(pg, "t1") == (T, "w1"), "team session must not hold a withdrawn visit"
                assert sid in [s["session_id"] for s in body["sessions"]]

    asyncio.run(scenario())
