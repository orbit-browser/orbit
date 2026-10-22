"""팀 수집 모드 — 수집 창, 인제스트 판정, 반영 직전 재판정, 스트림 정리, 빼기·되돌리기.

설계: docs/team-collect-mode.md. 권한 근거는 언제나 지금 실행하는 SQL이다. 외부 API(임베딩·LLM)를 기다리기
전에 읽은 멤버십·창 상태로는 나중의 쓰기를 허락하지 않는다.

잠금 순서: 수집 창 행을 먼저 잠근다(판정·반영·되돌리기는 FOR SHARE, 끝내기·빼기·탈퇴 정리는 FOR UPDATE).
그다음 **새 문장에서** 멤버십·창·방문 표시를 다시 읽는다. READ COMMITTED에서 잠금을 기다린 뒤의 새 문장은
상대가 커밋한 결과를 본다. 그래서 빼기·탈퇴가 진행 중인 인제스트의 팀 표시도 지우고, 인제스트는 끝난 뒤의
빼기·탈퇴 결과를 본다. 이 모듈의 함수는 커밋하지 않는다 — 호출측이 한 트랜잭션으로 묶는다.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, exists, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import (
    ExplorationEvent,
    Session as SessionModel,
    SessionEvent,
    UserSetting,
    Workspace,
    WorkspaceCollectWindow as Window,
    WorkspaceMember,
    WorkspaceSession,
)
from .event_filter import is_team_blocked_url

MAX_WINDOW = timedelta(hours=8)
# 기기 시계를 믿지 않는 여유. 미래 시각과 늦게 도착한 방문의 끝 경계에 쓴다(§2.2 S1).
CLOCK_MARGIN = timedelta(minutes=5)
EXCLUDED_DOMAINS_KEY = "team_collect_excluded_domains"
CONSENT_KEY = "team_collect_consented"


class CollectError(Exception):
    """not_found → 404, conflict → 409."""

    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(moment: datetime) -> datetime:
    # SQLite 시험 DB는 tz 없는 값을 돌려준다. 저장값은 모두 UTC다.
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def window_end(window: Window) -> datetime:
    expires = _aware(window.expires_at)
    return min(_aware(window.ended_at), expires) if window.ended_at else expires


def is_active(window: Window, now: datetime) -> bool:
    return window.ended_at is None and _aware(window.expires_at) > now and window.withdrawn_at is None


def visit_in_window(
    started_at: datetime, end: datetime, visited_at: datetime, received_at: datetime
) -> bool:
    """서버 수신 시각 기준 판정(S1). 애매하면 False(개인).

    창이 열려 있는 동안 도착한 방문은 도착보다 앞서므로 실제로 창 안이다. 늦게 도착한 방문은 끝 직전
    CLOCK_MARGIN 안이면 기기 시계가 느린 경우와 구분할 수 없어 개인으로 둔다.
    """
    started_at, end, visited_at = _aware(started_at), _aware(end), _aware(visited_at)
    if visited_at > received_at + CLOCK_MARGIN or visited_at < started_at:
        return False
    if received_at < end:
        return True
    return visited_at < end - CLOCK_MARGIN


async def excluded_domains(db: AsyncSession, user_id: str) -> list[str]:
    row = await db.get(UserSetting, (user_id, EXCLUDED_DOMAINS_KEY))
    value = row.value if row is not None else None
    return [d for d in value if isinstance(d, str)] if isinstance(value, list) else []


# ── 인제스트 판정 ──────────────────────────────────────────────


@dataclass(frozen=True)
class LabelRequest:
    event_id: str
    workspace_id: str | None
    window_id: str | None
    device_id: str | None
    url: str
    visited_at: datetime


@dataclass
class Judgement:
    # 팀 표시를 받아들인 방문: event_id → (workspace_id, window_id)
    labels: dict[str, tuple[str, str]]
    downgraded: int
    window_closed: bool


async def _lock_windows_for_share(db: AsyncSession, window_ids: set[str]) -> None:
    if window_ids:
        await db.execute(
            select(Window.id).where(Window.id.in_(window_ids)).with_for_update(read=True)
        )


async def judge_labels(
    db: AsyncSession, user_id: str, requests: list[LabelRequest], received_at: datetime
) -> Judgement:
    """팀 표시를 단 방문마다 창·기기·멤버십·가입 시각·허용·빼기·시각·주소를 판정한다(§2.2).

    표시는 이벤트가 실은 창 하나로만 판정한다(S'1) — 서버가 시각으로 다른 창을 골라 주지 않는다.
    """
    asked = [r for r in requests if r.workspace_id or r.window_id]
    if not asked:
        return Judgement(labels={}, downgraded=0, window_closed=False)

    window_ids = {r.window_id for r in asked if r.window_id}
    await _lock_windows_for_share(db, window_ids)
    rows = (
        await db.execute(
            select(Window, WorkspaceMember.joined_at, Workspace.collect_allowed)
            .join(Workspace, Workspace.id == Window.workspace_id)
            .outerjoin(
                WorkspaceMember,
                and_(
                    WorkspaceMember.workspace_id == Window.workspace_id,
                    WorkspaceMember.user_id == Window.user_id,
                ),
            )
            .where(Window.id.in_(window_ids), Window.user_id == user_id)
            .execution_options(populate_existing=True)
        )
    ).all() if window_ids else []
    windows = {window.id: (window, joined_at, allowed) for window, joined_at, allowed in rows}
    excluded = await excluded_domains(db, user_id)

    labels: dict[str, tuple[str, str]] = {}
    window_closed = False
    for request in asked:
        found = windows.get(request.window_id or "")
        if found is None:
            window_closed = True
            continue
        window, joined_at, allowed = found
        current_member = joined_at is not None and _aware(window.started_at) >= _aware(joined_at)
        if not (current_member and allowed and is_active(window, received_at)):
            window_closed = True
        if (
            current_member
            and allowed
            and window.withdrawn_at is None
            and window.workspace_id == request.workspace_id
            and request.device_id is not None
            and window.device_id == request.device_id
            and visit_in_window(window.started_at, window_end(window), request.visited_at, received_at)
            and not is_team_blocked_url(request.url, excluded)
        ):
            labels[request.event_id] = (window.workspace_id, window.id)
    return Judgement(labels=labels, downgraded=len(asked) - len(labels), window_closed=window_closed)


# ── 배치 반영 직전 재판정 (§6.4 ①③) ──────────────────────────────


async def confirm_team_events(
    db: AsyncSession, user_id: str, workspace_id: str, events: list[dict]
) -> bool:
    """LLM 대기 뒤 반영 트랜잭션에서 다시 판정한다. 하나라도 어기면 False(그룹 전체를 개인으로).

    claim 때 읽은 표시·멤버십은 근거가 될 수 없다. 창을 잠근 뒤 멤버십·가입 시각·이벤트 표시를 새로 읽는다.
    """
    window_ids = {e.get("collect_window_id") for e in events}
    if not events or None in window_ids:
        return False
    await _lock_windows_for_share(db, window_ids)  # type: ignore[arg-type]
    joined_at = await db.scalar(
        select(WorkspaceMember.joined_at).where(
            WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == user_id
        )
    )
    if joined_at is None:
        return False
    windows = (
        await db.execute(
            select(Window.id, Window.user_id, Window.workspace_id, Window.started_at).where(
                Window.id.in_(window_ids)
            )
        )
    ).all()
    if len(windows) != len(window_ids) or any(
        owner != user_id or ws != workspace_id or _aware(started) < _aware(joined_at)
        for _id, owner, ws, started in windows
    ):
        return False
    labels = (
        await db.execute(
            select(ExplorationEvent.id, ExplorationEvent.workspace_id, ExplorationEvent.collect_window_id)
            .where(ExplorationEvent.id.in_([e["id"] for e in events]))
            .execution_options(populate_existing=True)
        )
    ).all()
    expected = {e["id"]: e.get("collect_window_id") for e in events}
    return len(labels) == len(expected) and all(
        ws == workspace_id and window_id == expected[event_id]
        for event_id, ws, window_id in labels
    )


async def strip_labels(db: AsyncSession, event_ids: list[str]) -> None:
    if event_ids:
        await db.execute(
            update(ExplorationEvent)
            .where(ExplorationEvent.id.in_(event_ids))
            .values(workspace_id=None, collect_window_id=None)
        )


# ── 수집 창 ──────────────────────────────────────────────


async def _lock_windows(db: AsyncSession, *conditions) -> list[Window]:
    result = await db.execute(
        select(Window).where(*conditions).with_for_update().execution_options(populate_existing=True)
    )
    return list(result.scalars().all())


def _close(window: Window, reason: str, now: datetime) -> None:
    expires = _aware(window.expires_at)
    if expires <= now:
        window.ended_at, window.ended_reason = expires, "expired"
    else:
        window.ended_at, window.ended_reason = now, reason


async def close_windows(db: AsyncSession, reason: str, now: datetime, *conditions) -> list[Window]:
    """조건에 맞는 끝나지 않은 창을 끝낸다. 이미 만료된 창은 만료 시각으로 닫는다."""
    windows = await _lock_windows(db, Window.ended_at.is_(None), *conditions)
    for window in windows:
        _close(window, reason, now)
    await db.flush()
    return windows


async def start_window(
    db: AsyncSession, workspace_id: str, user_id: str, device_id: str, minutes: int, now: datetime
) -> tuple[Window, str | None]:
    """같은 사람·기기의 끝나지 않은 창을 닫고 새 창을 연다. 동시 시작은 부분 유니크 인덱스가 막는다(S2)."""
    closed = await close_windows(
        db, "switch", now, Window.user_id == user_id, Window.device_id == device_id
    )
    ended_workspace_id = next(
        (w.workspace_id for w in closed if w.ended_reason == "switch" and w.workspace_id != workspace_id),
        None,
    )
    window = Window(
        workspace_id=workspace_id,
        user_id=user_id,
        device_id=device_id,
        started_at=now,
        expires_at=now + min(timedelta(minutes=minutes), MAX_WINDOW),
    )
    db.add(window)
    await db.flush()
    return window, ended_workspace_id


async def active_windows(db: AsyncSession, now: datetime, *conditions) -> list[Window]:
    result = await db.execute(
        select(Window)
        .where(
            Window.ended_at.is_(None),
            Window.withdrawn_at.is_(None),
            Window.expires_at > now,
            *conditions,
        )
        .order_by(Window.started_at)
    )
    return list(result.scalars().all())


# ── 탈퇴·추방·팀 삭제 정리 (§6.3, S'2) ──────────────────────────────


async def release_stream(
    db: AsyncSession, workspace_id: str, user_id: str | None, reason: str, now: datetime
) -> list[str]:
    """그 팀(user_id 가 있으면 그 사람)의 수집 스트림을 푼다. 스트림을 비운 세션 id 를 돌려준다.

    순서가 중요하다: ① 창 행을 모두 FOR UPDATE 로 잠그고 열린 창을 닫는다 — 진행 중인 인제스트(FOR SHARE)가
    커밋할 때까지 기다린다. ② 방문 표시 ③ 세션 스트림을 비운다(공유 행 삭제는 호출측 1단계 코드). 거꾸로 하면
    그 사이 커밋된 팀 표시가 낡은 채 남는다.
    """
    owner = [Window.user_id == user_id] if user_id else []
    await _lock_windows(db, Window.workspace_id == workspace_id, *owner)
    await close_windows(db, reason, now, Window.workspace_id == workspace_id, *owner)

    event_owner = [ExplorationEvent.user_id == user_id] if user_id else []
    await db.execute(
        update(ExplorationEvent)
        .where(ExplorationEvent.workspace_id == workspace_id, *event_owner)
        .values(workspace_id=None, collect_window_id=None)
    )
    session_owner = [SessionModel.user_id == user_id] if user_id else []
    cleared = await db.execute(
        update(SessionModel)
        .where(SessionModel.collect_workspace_id == workspace_id, *session_owner)
        .values(collect_workspace_id=None)
        .returning(SessionModel.id)
    )
    return list(cleared.scalars().all())


# ── 빼기·되돌리기 (§1.4-4, §3.3 N1) ──────────────────────────────


async def withdraw(
    db: AsyncSession, workspace_id: str, user_id: str, window_id: str, now: datetime
) -> int:
    """그 창의 세션에 묶이지 않은 내 방문을 개인으로 돌린다. 열린 창이면 창도 끝낸다(S'3).

    창 행 FOR UPDATE 잠금이 진행 중인 인제스트를 기다리게 해, 그 인제스트가 막 저장한 팀 표시도 비운다.
    withdrawn_at 은 이후 도착하는 이 창의 방문을 개인으로 받게 한다.
    """
    locked = await _lock_windows(
        db, Window.id == window_id, Window.workspace_id == workspace_id, Window.user_id == user_id
    )
    if not locked:
        raise CollectError("not_found", "collect window not found")
    window = locked[0]
    if window.ended_at is None:
        _close(window, "stop", now)
    window.withdrawn_at = window.withdrawn_at or now
    await db.flush()
    result = await db.execute(
        update(ExplorationEvent)
        .where(
            ExplorationEvent.collect_window_id == window_id,
            ExplorationEvent.user_id == user_id,
            ~exists().where(SessionEvent.event_id == ExplorationEvent.id),
        )
        .values(workspace_id=None, collect_window_id=None)
        .returning(ExplorationEvent.id)
    )
    return len(result.scalars().all())


async def window_session_ids(db: AsyncSession, user_id: str, window_id: str) -> list[str]:
    """그 창의 방문이 들어간 내 세션(흡수된 것 제외). 공유가 풀린 것도 포함 — 돌아보기에서 상태를 보인다."""
    result = await db.execute(
        select(SessionModel.id)
        .join(SessionEvent, SessionEvent.session_id == SessionModel.id)
        .join(ExplorationEvent, ExplorationEvent.id == SessionEvent.event_id)
        .where(
            ExplorationEvent.collect_window_id == window_id,
            SessionModel.user_id == user_id,
            SessionModel.status != "merged",
        )
        .distinct()
    )
    return list(result.scalars().all())


async def restore(db: AsyncSession, workspace_id: str, user_id: str, session_id: str) -> None:
    """돌아보기에서 뺀 수집 세션을 되돌린다 — 공유 행과 스트림 열을 한 트랜잭션에서 함께(N1).

    공유 행만 되살리면 "팀에 보이는 개인 스트림 세션"이 되어 이후 개인 방문이 팀에 붙는다. 세션의 모든 방문이
    이 팀·이 사람의 현재 멤버십 이후 창 방문일 때만 허락한다 — 개인 방문이 섞였으면 되돌리지 않는다.
    잠금은 다른 경로와 같은 순서(창 → 세션)로 잡는다. 탈퇴 정리(창 FOR UPDATE → 세션 UPDATE)와 거꾸로 잡으면 교착한다.
    """
    window_ids = set(
        (
            await db.execute(
                select(ExplorationEvent.collect_window_id)
                .join(SessionEvent, SessionEvent.event_id == ExplorationEvent.id)
                .where(SessionEvent.session_id == session_id)
            )
        ).scalars().all()
    )
    await _lock_windows_for_share(db, {w for w in window_ids if w})
    session = await db.scalar(
        select(SessionModel)
        .where(SessionModel.id == session_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if session is None or session.user_id != user_id:
        raise CollectError("not_found", "session not found")
    if session.status != "active":
        raise CollectError("conflict", "session is not active")
    if not window_ids or None in window_ids:
        raise CollectError("conflict", "session has visits outside team collection")

    joined_at = await db.scalar(
        select(WorkspaceMember.joined_at).where(
            WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == user_id
        )
    )
    rows = (
        await db.execute(
            select(ExplorationEvent.workspace_id, Window.user_id, Window.workspace_id, Window.started_at)
            .join(SessionEvent, SessionEvent.event_id == ExplorationEvent.id)
            .outerjoin(Window, Window.id == ExplorationEvent.collect_window_id)
            .where(SessionEvent.session_id == session_id)
        )
    ).all()
    if joined_at is None or not rows or any(
        event_ws != workspace_id
        or owner != user_id
        or window_ws != workspace_id
        or started is None
        or _aware(started) < _aware(joined_at)
        for event_ws, owner, window_ws, started in rows
    ):
        raise CollectError("conflict", "session cannot be restored to this team")

    session.collect_workspace_id = workspace_id
    if await db.get(WorkspaceSession, (workspace_id, session_id)) is None:
        db.add(WorkspaceSession(workspace_id=workspace_id, session_id=session_id, shared_by=user_id))
    await db.flush()
