"""팀 수집 모드 — 불변 조건 시험(실제 SQL, 메모리 SQLite). docs/team-collect-mode.md §6.

PostgreSQL 전용 경로(인제스트 INSERT ON CONFLICT, 배치 반영, 잠금 경합)는 test_team_collect_pg.py가 본다.
외부 서비스(임베딩·Qdrant·LLM)는 대역이고, 대역은 Qdrant 필터를 일부러 무시한다 — 경계는 SQL이어야 한다.
"""

import asyncio
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi import FastAPI, Request
from sqlalchemy import JSON, MetaData, create_engine, select, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session as SyncSession

from app.api import ask, search, sessions, team_collect, workspaces
from app.api.deps import current_user_id
from app.db.models import (
    Base,
    ExplorationEvent,
    Session,
    SessionEvent,
    SessionVersion,
    User,
    UserSetting,
    Workspace,
    WorkspaceCollectWindow,
    WorkspaceMember,
    WorkspaceSession,
)
from app.db.session import get_db
from app.services import ask_service, merge_service
from app.services import team_collect as collect
from app.services.event_filter import is_team_blocked_url, teammate_url
from tests.test_workspace_security import MemoryDB

NOW = datetime.now(timezone.utc)
T = "team"  # 수집 허용된 팀. olive=owner, mina=member
OTHER = "other-team"  # mina 가 owner 인 다른 팀
DEVICE = "device-1"


class DB(MemoryDB):
    async def rollback(self):
        self.sync.rollback()


def _event(eid, user, *, url=None, ws=None, window=None, status="processed", minutes_ago=30):
    url = url or f"https://example.test/{eid}?q=secret-{eid}&token=t{eid}#frag"
    return ExplorationEvent(
        id=eid, user_id=user, url=url, normalized_url=url, title=f"title-{eid}", domain="example.test",
        visited_at=NOW - timedelta(minutes=minutes_ago), sync_status=status, workspace_id=ws,
        collect_window_id=window, referrer_url="https://private.test/previous?q=referrer",
        previous_event_id="prev-1", device_id=DEVICE, content_excerpt=f"excerpt-{eid}",
    )


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
        sync.add_all(User(id=u, google_sub=u, email=f"{u}@example.test", name=u) for u in ("olive", "mina", "eve"))
        sync.add_all([
            Workspace(id=T, name=T, hue="#000", collect_allowed=True),
            Workspace(id=OTHER, name=OTHER, hue="#000", collect_allowed=True),
        ])
        sync.flush()
        sync.add_all([
            WorkspaceMember(workspace_id=T, user_id="olive", role="owner", joined_at=NOW - timedelta(days=2)),
            WorkspaceMember(workspace_id=T, user_id="mina", role="member", joined_at=NOW - timedelta(days=1)),
            WorkspaceMember(workspace_id=OTHER, user_id="mina", role="owner", joined_at=NOW - timedelta(days=1)),
        ])
        # mina 의 팀 수집 창(2시간 전 시작, 아직 열림)과 그 창으로 만들어진 수집 세션.
        sync.add(WorkspaceCollectWindow(
            id="w1", workspace_id=T, user_id="mina", device_id=DEVICE,
            started_at=NOW - timedelta(hours=2), expires_at=NOW + timedelta(hours=1),
        ))
        sync.add(Session(
            id="collected", user_id="mina", status="active", title="collected", summary={"overview": "o"},
            summary_status="done", folder_id="mina-folder", collect_workspace_id=T,
            tabs=[{"tab_id": "e1", "title": "t", "url": "https://example.test/e1?q=secret-e1&token=te1#frag"}],
        ))
        sync.add(Session(id="personal", user_id="mina", status="active", title="personal", summary={}, summary_status="done"))
        sync.add_all([
            _event("e1", "mina", ws=T, window="w1"),
            _event("e2", "mina", ws=T, window="w1"),
            _event("pending-team", "mina", ws=T, window="w1", status="pending", minutes_ago=5),
            _event("p1", "mina"),
        ])
        sync.flush()
        sync.add_all([
            SessionEvent(session_id="collected", event_id="e1", sequence_order=0),
            SessionEvent(session_id="collected", event_id="e2", sequence_order=1),
            SessionEvent(session_id="personal", event_id="p1", sequence_order=0),
            SessionVersion(session_id="collected", version=1, title="v1"),
            WorkspaceSession(workspace_id=T, session_id="collected", shared_by="mina"),
        ])
        sync.commit()
        yield DB(sync)
    engine.dispose()


@pytest.fixture
def api(db, monkeypatch):
    app = FastAPI()
    for router in (workspaces.router, team_collect.router, sessions.router, search.router, ask.router):
        app.include_router(router)

    async def database():
        yield db

    async def user(request: Request):
        return request.headers["x-test-user"]

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[current_user_id] = user

    async def embed(_text):
        return [0.1]

    async def every_session(*args, **kwargs):
        # Qdrant 필터를 무시하고 모든 세션을 후보로 돌려준다 — SQL이 경계여야 한다.
        return [(s, 0.9) for s in ("collected", "personal")]

    async def ids_only(*args, **kwargs):
        return [s for s, _ in await every_session()]

    async def score(_query, rows):
        scored: dict[str, list] = {}
        for session_event, event in rows:
            scored.setdefault(session_event.session_id, []).append(
                (0.9, session_event.sequence_order, 0, event, event.content_excerpt or "")
            )
        return scored

    async def answer(_system, prompt):
        yield "answer", "test-model"

    async def nothing(*_args, **_kwargs):
        return None

    monkeypatch.setattr(search, "embed", embed)
    monkeypatch.setattr(search, "search_similar", ids_only)
    monkeypatch.setattr(search, "search_similar_with_scores", every_session)
    monkeypatch.setattr(ask_service, "score_passages", score)
    monkeypatch.setattr(ask, "chat_completion_stream_with_meta", answer)
    monkeypatch.setattr(sessions, "delete_point", nothing)
    monkeypatch.setattr(workspaces, "set_stream_payload", nothing)
    monkeypatch.setattr(team_collect, "set_stream_payload", nothing)

    def request(method, path, user="mina", **kwargs):
        async def send():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                return await client.request(method, path, headers={"x-test-user": user}, **kwargs)
        return asyncio.run(send())

    return request


def _window(db, wid):
    return db.sync.get(WorkspaceCollectWindow, wid)


def _judge(db, user, requests, received_at=None):
    return asyncio.run(collect.judge_labels(db, user, requests, received_at or NOW))


def _req(eid="new", *, ws=T, window="w1", device=DEVICE, url="https://example.test/page", minutes_ago=10):
    return collect.LabelRequest(
        event_id=eid, workspace_id=ws, window_id=window, device_id=device, url=url,
        visited_at=NOW - timedelta(minutes=minutes_ago),
    )


# ── 순수 판정 ──────────────────────────────────────────────


@pytest.mark.parametrize(
    ("visited", "received", "end", "expected"),
    [
        # 창: 10:00 시작, 12:00 끝. 기대값은 손으로 쓴다.
        ("10:00", "10:01", "12:00", True),   # 열린 동안 도착, 시작 시각 그대로
        ("09:59", "10:01", "12:00", False),  # 시작 전
        ("11:59", "11:59", "12:00", True),   # 열린 동안 도착(끝 직전)
        ("11:54", "13:00", "12:00", True),   # 늦게 도착, 끝 6분 전
        ("11:56", "13:00", "12:00", False),  # 늦게 도착, 끝 4분 전 — 시계 차이를 구분할 수 없어 개인
        ("12:01", "13:00", "12:00", False),  # 끝난 뒤 방문
        ("10:30", "10:24", "12:00", False),  # 수신보다 6분 미래(기기 시계가 빠름)
        ("10:28", "10:24", "12:00", True),   # 수신보다 4분 미래는 여유 안
    ],
)
def test_visit_in_window_uses_server_receive_time(visited, received, end, expected):
    """불변 조건 10(S1): 서버 수신 시각 기준, 애매하면 개인."""
    def at(hm):
        hour, minute = map(int, hm.split(":"))
        return datetime(2026, 10, 23, hour, minute, tzinfo=timezone.utc)

    assert collect.visit_in_window(at("10:00"), at(end), at(visited), at(received)) is expected


@pytest.mark.parametrize(
    ("url", "blocked"),
    [
        ("https://example.test/article", False),
        ("https://www.gov.kr/portal/main", True),  # 민감 도메인
        ("https://www.mois.go.kr/notice/1", False),  # 공지성 .go.kr 은 민감 아님(#24)
        ("https://shop.example.test/login", True),  # 로그인 경로
        ("https://accounts.google.com/ServiceLogin", True),  # 로그인 호스트
        ("https://login.microsoftonline.com/common/oauth2", True),
        ("https://github.com/session", True),
        ("https://github.com/sessionize/app", False),
        ("https://mail.google.com/mail/u/0/", True),  # 웹메일(기본 제외)
        ("https://mail.naver.com/v2/folders/0", True),
        ("https://app.slack.com/client/T1/C1", True),  # 메신저
        ("https://discord.com/channels/1/2", True),
        ("https://discord.com/blog", False),
        ("https://www.instagram.com/direct/inbox/", True),
        ("https://www.google.com/search?q=private", True),  # 검색 결과 페이지
        ("https://www.google.com/search", True),
        ("https://search.naver.com/search.naver?query=x", True),
        ("https://www.youtube.com/results?search_query=x", True),
        ("https://www.youtube.com/watch?v=1", False),
        ("not a url", True),  # 판정할 수 없으면 막는다
    ],
)
def test_team_blocked_urls(url, blocked):
    """불변 조건 11: 민감·로그인 호스트/경로·기본 제외는 팀 스트림에 없다."""
    assert is_team_blocked_url(url) is blocked


def test_team_blocked_urls_honour_user_exclusions_by_suffix():
    assert is_team_blocked_url("https://docs.corp.example/a", ["corp.example"]) is True
    assert is_team_blocked_url("https://notcorp.example/a", ["corp.example"]) is False


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://example.test/a/b?q=secret#frag", "https://example.test/a/b"),
        ("https://user:pw@example.test:8443/x?y=1", "https://example.test:8443/x"),
        ("https://example.test", "https://example.test/"),
        ("https://www.kbstar.com/quics?page=account", "https://www.kbstar.com/"),  # 민감 URL은 도메인만
        ("", ""),
    ],
)
def test_teammate_url(url, expected):
    """불변 조건 7: 팀원 응답의 주소는 쿼리·프래그먼트·계정 정보가 없다."""
    assert teammate_url(url) == expected


# ── 인제스트 판정(실제 SQL) ──────────────────────────────────────


def test_judge_accepts_valid_label(db):
    judgement = _judge(db, "mina", [_req()])
    assert judgement.labels == {"new": (T, "w1")}
    assert (judgement.downgraded, judgement.window_closed) == (0, False)


@pytest.mark.parametrize(
    "request_kwargs",
    [
        {"device": "other-device"},  # 다른 기기
        {"device": None},
        {"ws": OTHER},  # 창과 다른 팀
        {"window": "missing"},
        {"window": None},
        {"url": "https://mail.google.com/mail/u/0/"},
        {"url": "https://www.gov.kr/x"},
        {"minutes_ago": 125},  # 창 시작 전
    ],
)
def test_judge_downgrades_invalid_labels(db, request_kwargs):
    """불변 조건 8: 서버가 창·기기·팀·주소를 다시 판정한다. 하나라도 어기면 개인."""
    judgement = _judge(db, "mina", [_req(**request_kwargs)])
    assert judgement.labels == {} and judgement.downgraded == 1


def test_judge_rejects_someone_elses_window(db):
    """남의 창 번호를 실어도 팀 표시를 받지 못한다(창은 요청자 것이어야 한다)."""
    judgement = _judge(db, "eve", [_req()])
    assert judgement.labels == {} and judgement.window_closed is True


def test_judge_rejects_when_owner_disallowed(db):
    db.sync.get(Workspace, T).collect_allowed = False
    db.sync.commit()
    judgement = _judge(db, "mina", [_req()])
    assert judgement.labels == {} and judgement.window_closed is True


def test_judge_rejects_withdrawn_window(db):
    """불변 조건 14: 빼기 뒤 도착하는 그 창의 방문은 개인."""
    _window(db, "w1").withdrawn_at = NOW - timedelta(minutes=1)
    db.sync.commit()
    assert _judge(db, "mina", [_req()]).labels == {}


def test_judge_rejects_window_older_than_current_membership(db):
    """불변 조건 15: 탈퇴 후 재가입하면 그 전에 열린 창은 무효다."""
    db.sync.get(WorkspaceMember, (T, "mina")).joined_at = NOW - timedelta(minutes=30)
    db.sync.commit()
    assert _judge(db, "mina", [_req()]).labels == {}


def test_judge_rejects_non_member(db):
    db.sync.delete(db.sync.get(WorkspaceMember, (T, "mina")))
    db.sync.commit()
    judgement = _judge(db, "mina", [_req()])
    assert judgement.labels == {} and judgement.window_closed is True


def test_judge_honours_user_excluded_domains(db):
    db.sync.add(UserSetting(user_id="mina", key=collect.EXCLUDED_DOMAINS_KEY, value=["example.test"]))
    db.sync.commit()
    assert _judge(db, "mina", [_req()]).labels == {}


def test_judge_uses_only_the_window_the_event_names(db):
    """불변 조건 17(S'1): 끝나고 빼진 창 1을 가리키는 방문은 그 시각에 창 2가 열려 있어도 개인이다."""
    first = _window(db, "w1")
    first.ended_at = NOW - timedelta(hours=1)
    first.withdrawn_at = NOW - timedelta(minutes=50)
    db.sync.add(WorkspaceCollectWindow(
        id="w2", workspace_id=T, user_id="mina", device_id=DEVICE,
        started_at=NOW - timedelta(minutes=40), expires_at=NOW + timedelta(hours=1),
    ))
    db.sync.commit()
    # 기기 시계가 빨라 창 2 시간대로 찍힌 창 1의 방문
    assert _judge(db, "mina", [_req(window="w1", minutes_ago=20)]).labels == {}
    assert _judge(db, "mina", [_req(window="w2", minutes_ago=20)]).labels == {"new": (T, "w2")}


def test_judge_reports_closed_window(db):
    """S'5: window_closed 는 창이 끝났을 때만. 제외 목록 때문에만 강등되면 False."""
    blocked = _judge(db, "mina", [_req(url="https://mail.google.com/mail/u/0/")])
    assert blocked.downgraded == 1 and blocked.window_closed is False
    _window(db, "w1").ended_at = NOW - timedelta(minutes=1)
    db.sync.commit()
    assert _judge(db, "mina", [_req(minutes_ago=30)], NOW).window_closed is True


# ── 수집 창 API ──────────────────────────────────────────────


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", f"/workspaces/{T}/collect"),
        ("POST", f"/workspaces/{T}/collect"),
        ("DELETE", f"/workspaces/{T}/collect"),
        ("GET", f"/workspaces/{T}/collect/windows/w1/sessions"),
        ("POST", f"/workspaces/{T}/collect/windows/w1/withdraw"),
        ("POST", f"/workspaces/{T}/collect/sessions/collected/restore"),
    ],
)
def test_collect_routes_hide_team_from_non_members(api, method, path):
    """불변 조건 4: 비멤버는 404."""
    body = {"device_id": DEVICE, "consent_version": "v1"} if method == "POST" and path.endswith("/collect") else None
    assert api(method, path, user="eve", json=body).status_code == 404


def test_member_cannot_change_collect_allowed(api, db):
    """불변 조건 4: 멤버의 owner 전용 작업은 403."""
    assert api("PATCH", f"/workspaces/{T}", user="mina", json={"collect_allowed": False}).status_code == 403
    assert db.sync.get(Workspace, T).collect_allowed is True


def test_owner_disallow_closes_every_window(api, db):
    response = api("PATCH", f"/workspaces/{T}", user="olive", json={"collect_allowed": False})
    assert response.status_code == 200 and response.json()["collect_allowed"] is False
    assert _window(db, "w1").ended_reason == "disallowed"
    start = api("POST", f"/workspaces/{T}/collect", json={"device_id": DEVICE, "consent_version": "v1"})
    assert start.status_code == 409


def test_start_closes_previous_window_on_same_device_and_records_consent(api, db):
    response = api(
        "POST", f"/workspaces/{OTHER}/collect", json={"device_id": DEVICE, "duration_minutes": 30, "consent_version": "v3"}
    )
    assert response.status_code == 201
    body = response.json()
    assert body["ended_workspace_id"] == T
    assert _window(db, "w1").ended_reason == "switch"
    started = datetime.fromisoformat(body["window"]["started_at"])
    assert datetime.fromisoformat(body["window"]["expires_at"]) - started == timedelta(minutes=30)
    open_windows = db.sync.scalars(
        select(WorkspaceCollectWindow).where(WorkspaceCollectWindow.ended_at.is_(None))
    ).all()
    assert [w.workspace_id for w in open_windows] == [OTHER]
    consent = db.sync.get(UserSetting, ("mina", collect.CONSENT_KEY)).value
    assert consent[OTHER]["version"] == "v3"


def test_start_rejects_durations_over_eight_hours(api):
    response = api("POST", f"/workspaces/{T}/collect", json={"device_id": DEVICE, "duration_minutes": 600, "consent_version": "v1"})
    assert response.status_code == 422


def test_stop_without_device_closes_all_my_windows_only(api, db):
    """S3: device_id 없이 끄면 그 팀의 내 모든 기기 창을 끝낸다. 남의 창은 그대로."""
    db.sync.add_all([
        WorkspaceCollectWindow(id="w-home", workspace_id=T, user_id="mina", device_id="home",
                               started_at=NOW - timedelta(minutes=5), expires_at=NOW + timedelta(hours=1)),
        WorkspaceCollectWindow(id="w-olive", workspace_id=T, user_id="olive", device_id="o",
                               started_at=NOW - timedelta(minutes=5), expires_at=NOW + timedelta(hours=1)),
    ])
    db.sync.commit()
    assert api("DELETE", f"/workspaces/{T}/collect?reason=stop").status_code == 204
    assert _window(db, "w1").ended_at is not None and _window(db, "w-home").ended_at is not None
    assert _window(db, "w-olive").ended_at is None


def test_status_lists_collecting_members_without_their_devices(api, db):
    body = api("GET", f"/workspaces/{T}/collect", user="olive").json()
    assert body["allowed"] is True and body["my_windows"] == []
    assert [m["user_id"] for m in body["collecting"]] == ["mina"]
    assert "device_id" not in body["collecting"][0]
    mine = api("GET", f"/workspaces/{T}/collect").json()["my_windows"]
    assert [w["window_id"] for w in mine] == ["w1"]


def test_workspace_list_shows_only_this_devices_window(api):
    items = {i["workspace_id"]: i for i in api("GET", f"/workspaces?device_id={DEVICE}").json()}
    assert items[T]["my_collect"]["window_id"] == "w1" and items[T]["collect_allowed"] is True
    other_device = {i["workspace_id"]: i for i in api("GET", "/workspaces?device_id=else").json()}
    assert other_device[T]["my_collect"] is None


# ── 빼기·되돌리기 ──────────────────────────────────────────────


def test_withdraw_returns_unsessioned_visits_to_personal_and_closes_window(api, db):
    """불변 조건 14, S'3: 세션에 묶이지 않은 방문은 개인으로, 열린 창은 함께 끝낸다."""
    response = api("POST", f"/workspaces/{T}/collect/windows/w1/withdraw")
    assert response.status_code == 200
    body = response.json()
    assert body["withdrawn_events"] == 1 and body["window_closed"] is True
    assert [s["session_id"] for s in body["sessions"]] == ["collected"]
    pending = db.sync.get(ExplorationEvent, "pending-team")
    assert (pending.workspace_id, pending.collect_window_id) == (None, None)
    assert db.sync.get(ExplorationEvent, "e1").workspace_id == T  # 이미 세션이 된 방문은 세션별로 뺀다
    window = _window(db, "w1")
    assert window.withdrawn_at is not None and window.ended_reason == "stop"


def test_other_users_window_is_404(api):
    """E2E 16: 남의 창 번호로 돌아보기·빼기 → 404."""
    assert api("GET", f"/workspaces/{T}/collect/windows/w1/sessions", user="olive").status_code == 404
    assert api("POST", f"/workspaces/{T}/collect/windows/w1/withdraw", user="olive").status_code == 404
    assert api("POST", f"/workspaces/{T}/collect/sessions/collected/restore", user="olive").status_code == 404


def test_unshare_clears_stream_whoever_unshares(api, db):
    """§3.3: owner 가 남의 수집 세션 공유를 풀어도 스트림까지 비운다."""
    assert api("DELETE", f"/workspaces/{T}/sessions/collected", user="olive").status_code == 204
    assert db.sync.get(Session, "collected").collect_workspace_id is None


def test_restore_brings_back_share_and_stream_together(api, db):
    """불변 조건 16(N1): 되돌리기는 공유 행과 스트림을 함께 되살린다."""
    assert api("DELETE", f"/workspaces/{T}/sessions/collected").status_code == 204
    assert api("POST", f"/workspaces/{T}/collect/sessions/collected/restore").status_code == 204
    db.sync.expire_all()
    assert db.sync.get(Session, "collected").collect_workspace_id == T
    assert db.sync.get(WorkspaceSession, (T, "collected")) is not None


def test_restore_refuses_session_with_personal_visit(api, db):
    """N1: 공유가 풀린 사이 개인 방문이 붙었으면 되돌리지 않는다."""
    assert api("DELETE", f"/workspaces/{T}/sessions/collected").status_code == 204
    db.sync.add(_event("p-late", "mina"))
    db.sync.flush()
    db.sync.add(SessionEvent(session_id="collected", event_id="p-late", sequence_order=2))
    db.sync.commit()
    assert api("POST", f"/workspaces/{T}/collect/sessions/collected/restore").status_code == 409
    assert db.sync.get(WorkspaceSession, (T, "collected")) is None


def test_restore_refuses_personal_session(api):
    assert api("POST", f"/workspaces/{T}/collect/sessions/personal/restore").status_code == 409


def test_restore_refuses_after_rejoin(api, db):
    """불변 조건 15: 재가입 전 창의 세션은 되돌릴 수 없다."""
    assert api("DELETE", f"/workspaces/{T}/sessions/collected").status_code == 204
    db.sync.get(WorkspaceMember, (T, "mina")).joined_at = NOW
    db.sync.commit()
    assert api("POST", f"/workspaces/{T}/collect/sessions/collected/restore").status_code == 409


# ── 탈퇴·팀 삭제 ──────────────────────────────────────────────


def test_leave_releases_stream_and_hides_collected_session(api, db):
    """불변 조건 5: 탈퇴하면 수집 세션이 즉시 안 보이고, 창·방문·세션 스트림이 풀린다."""
    assert api("GET", "/sessions/collected", user="olive").status_code == 200
    assert api("DELETE", f"/workspaces/{T}/members/mina").status_code == 204
    db.sync.expire_all()
    for path in ("/sessions/collected", "/sessions/collected/events", "/sessions/collected/versions"):
        assert api("GET", path, user="olive").status_code == 404
    assert api("GET", f"/workspaces/{T}/sessions", user="olive").json() == []
    assert db.sync.get(Session, "collected").collect_workspace_id is None
    assert {db.sync.get(ExplorationEvent, e).workspace_id for e in ("e1", "e2", "pending-team")} == {None}
    assert _window(db, "w1").ended_reason == "left"


def test_owner_removal_records_reason(api, db):
    assert api("DELETE", f"/workspaces/{T}/members/mina", user="olive").status_code == 204
    assert _window(db, "w1").ended_reason == "removed"


def test_team_delete_releases_stream(api, db):
    assert api("DELETE", f"/workspaces/{T}", user="olive").status_code == 204
    db.sync.expire_all()
    assert db.sync.get(Session, "collected").collect_workspace_id is None
    assert db.sync.get(ExplorationEvent, "pending-team").workspace_id is None
    assert db.sync.scalars(select(WorkspaceCollectWindow).where(WorkspaceCollectWindow.workspace_id == T)).all() == []


# ── 팀원 응답 ──────────────────────────────────────────────


def _urls(value):
    """응답 안의 모든 url 값."""
    if isinstance(value, dict):
        return [v for k, v in value.items() if k == "url"] + [u for v in value.values() for u in _urls(v)]
    if isinstance(value, list):
        return [u for v in value for u in _urls(v)]
    return []


def _keys(value):
    if isinstance(value, dict):
        return set(value) | {k for v in value.values() for k in _keys(v)}
    if isinstance(value, list):
        return {k for v in value for k in _keys(v)}
    return set()


def test_teammate_responses_strip_query_and_private_fields(api):
    """불변 조건 7·S7, §7.3의 경로 전부: 쿼리 없는 주소, 폴더·스트림 없음, referrer·previous 없음."""
    responses = {
        "detail": api("GET", "/sessions/collected", user="olive").json(),
        "events": api("GET", "/sessions/collected/events", user="olive").json(),
        "versions": api("GET", "/sessions/collected/versions", user="olive").json(),
        "team list": api("GET", f"/workspaces/{T}/sessions", user="olive").json(),
        "team search": api("GET", f"/search?q=x&workspace_id={T}", user="olive").json(),
        "team memory": api("GET", f"/search?q=title&scope=memory&workspace_id={T}", user="olive").json(),
    }
    stream = api("POST", "/ask/stream", user="olive", json={"query": "title", "workspace_id": T})
    assert stream.status_code == 200 and "secret" not in stream.text and "token=" not in stream.text
    for name, body in responses.items():
        urls = _urls(body)
        assert all("?" not in u and "#" not in u for u in urls), name
        assert not {"referrer_url", "previous_event_id"} & _keys(body), name
        assert "secret" not in str(body) and "referrer" not in str(body), name
    assert _urls(responses["events"]) and _urls(responses["team memory"]["events"]), "paths must carry urls"
    assert responses["detail"]["folder_id"] is None and responses["detail"]["collect_workspace_id"] is None
    assert responses["team list"][0]["collected"] is True


def test_owner_still_sees_original_urls(api):
    detail = api("GET", "/sessions/collected").json()
    assert detail["tabs"][0]["url"].endswith("?q=secret-e1&token=te1#frag")
    assert detail["collect_workspace_id"] == T
    assert api("GET", "/sessions/collected/events").json()[0]["url"].startswith("https://example.test/e1?q=")


# ── 읽기·쓰기·팀 검색 범위 ──────────────────────────────────────


def test_teammate_reads_but_cannot_write_collected_session(api):
    """불변 조건 1·2: 팀원은 공유 행으로만 읽고, 쓰기는 소유자만."""
    assert api("GET", "/sessions/collected", user="olive").status_code == 200
    assert api("GET", "/sessions/collected", user="eve").status_code == 404
    assert api("PATCH", "/sessions/collected", user="olive", json={"alias": "x"}).status_code == 404
    assert api("DELETE", "/sessions/collected", user="olive").status_code == 404
    assert api("GET", "/sessions/personal", user="olive").status_code == 404


def test_team_memory_search_ignores_unsessioned_team_visits(api):
    """불변 조건 3: 세션에 묶이기 전의 팀 스트림 방문은 팀 검색에 나오지 않는다."""
    body = api("GET", f"/search?q=pending-team&scope=memory&workspace_id={T}", user="olive").json()
    found = [e["event_id"] for e in body["events"]]
    assert "pending-team" not in found and "p1" not in found
    # 소유자 개인 범위에서는 같은 검색어로 그 방문이 보인다(검색어가 맞는다는 대조).
    mine = api("GET", "/search?q=pending-team&scope=memory").json()
    assert "pending-team" in [e["event_id"] for e in mine["events"]]


# ── 병합 ──────────────────────────────────────────────


def test_merge_refuses_sessions_from_different_streams(db):
    """불변 조건 12: 스트림이 다른 세션은 수동·자동 어디서도 병합되지 않는다."""
    with pytest.raises(merge_service.MergeError) as exc:
        asyncio.run(merge_service.merge_sessions(db, "collected", "personal"))
    assert exc.value.code == "conflict"
    assert db.sync.get(Session, "personal").status == "active"


def test_merge_suggestions_skip_cross_stream_pairs(db, monkeypatch):
    from app.services import merge_suggester

    for sid in ("collected", "personal"):
        session = db.sync.get(Session, sid)
        session.embedding_status, session.keywords = "done", ["same"]
    db.sync.commit()

    async def vector(_sid):
        return [0.1]

    async def neighbours(*_args, **_kwargs):
        return [("collected", 0.99), ("personal", 0.99)]

    monkeypatch.setattr(merge_suggester, "get_vector", vector)
    monkeypatch.setattr(merge_suggester, "search_similar_with_scores", neighbours)
    assert asyncio.run(merge_suggester.find_merge_suggestions(db, "mina")) == []
