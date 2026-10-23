"""팀 수집 모드 API (docs/team-collect-mode.md §5).

권한 규칙은 팀 워크스페이스와 같다: 비멤버는 404(팀 존재를 알리지 않는다), 남의 수집 창·세션도 404.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import Session as SessionModel
from ..db.models import User, UserSetting, Workspace
from ..db.models import WorkspaceCollectWindow as Window
from ..db.session import get_db
from ..db.vector import set_stream_payload
from ..schemas.session import SessionDetail
from ..schemas.workspace import (
    CollectingMember,
    CollectStatusResponse,
    StartCollectRequest,
    StartCollectResponse,
    StopReason,
    WithdrawResponse,
)
from ..services import team_collect
from ..services.team_collect import CollectError
from ..services.workspaces import shared_workspaces
from .deps import current_user_id
from .sessions import _to_detail
from .workspaces import _member_or_404, window_item

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/workspaces", tags=["team-collect"])

_ERROR_STATUS = {"not_found": 404, "conflict": 409}


def _raise(exc: CollectError) -> None:
    raise HTTPException(status_code=_ERROR_STATUS[exc.code], detail=str(exc)) from exc


async def _own_sessions(db: AsyncSession, session_ids: list[str]) -> list[SessionDetail]:
    if not session_ids:
        return []
    sessions = (
        await db.execute(select(SessionModel).where(SessionModel.id.in_(session_ids)))
    ).scalars().all()
    shared = await shared_workspaces(db, [s.id for s in sessions])
    return [_to_detail(s, shared.get(s.id)) for s in sessions]


async def _record_consent(db: AsyncSession, user_id: str, workspace_id: str, version: str) -> None:
    row = await db.get(UserSetting, (user_id, team_collect.CONSENT_KEY))
    entry = {"version": version, "at": team_collect.utcnow().isoformat()}
    if row is None:
        db.add(UserSetting(user_id=user_id, key=team_collect.CONSENT_KEY, value={workspace_id: entry}))
    else:
        current = row.value if isinstance(row.value, dict) else {}
        row.value = {**current, workspace_id: entry}


@router.get("/{workspace_id}/collect", response_model=CollectStatusResponse)
async def collect_status(
    workspace_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> CollectStatusResponse:
    await _member_or_404(db, workspace_id, user_id)
    workspace = await db.get(Workspace, workspace_id)
    now = team_collect.utcnow()
    windows = await team_collect.active_windows(db, now, Window.workspace_id == workspace_id)
    latest: dict[str, Window] = {}
    for window in windows:
        if window.user_id not in latest or window.expires_at > latest[window.user_id].expires_at:
            latest[window.user_id] = window
    users = (
        {u.id: u for u in (await db.execute(select(User).where(User.id.in_(latest)))).scalars().all()}
        if latest
        else {}
    )
    return CollectStatusResponse(
        allowed=bool(workspace.collect_allowed),
        my_windows=[window_item(w) for w in windows if w.user_id == user_id],
        collecting=[
            CollectingMember(
                user_id=uid,
                name=users[uid].name if uid in users else None,
                picture=users[uid].picture if uid in users else None,
                expires_at=team_collect._aware(window.expires_at).isoformat(),
            )
            for uid, window in latest.items()
        ],
    )


@router.post("/{workspace_id}/collect", response_model=StartCollectResponse, status_code=201)
async def start_collect(
    workspace_id: str,
    body: StartCollectRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> StartCollectResponse:
    await _member_or_404(db, workspace_id, user_id)
    workspace = await db.get(Workspace, workspace_id)
    if not workspace.collect_allowed:
        raise HTTPException(status_code=409, detail="팀 수집이 허용되지 않은 팀입니다")
    now = team_collect.utcnow()
    try:
        window, ended_workspace_id = await team_collect.start_window(
            db, workspace_id, user_id, body.device_id, body.duration_minutes, now
        )
        await _record_consent(db, user_id, workspace_id, body.consent_version)
        await db.commit()
    except IntegrityError:
        # 같은 기기의 시작 요청이 동시에 들어왔다. 열린 창은 하나만 남는다 — 확장이 상태를 다시 읽는다.
        await db.rollback()
        raise HTTPException(status_code=409, detail="이미 시작 중인 수집 창이 있습니다")
    logger.info("team collect started (workspace_id=%s)", workspace_id)
    return StartCollectResponse(
        window=window_item(window), server_now=now.isoformat(), ended_workspace_id=ended_workspace_id
    )


@router.delete("/{workspace_id}/collect", status_code=204)
async def stop_collect(
    workspace_id: str,
    device_id: str | None = Query(None, min_length=1, max_length=64),
    reason: StopReason = Query("stop"),
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> None:
    """device_id 를 빼면 이 팀에 대한 내 모든 기기의 창을 끝낸다(S3). 열린 창이 없어도 204."""
    await _member_or_404(db, workspace_id, user_id)
    conditions = [Window.workspace_id == workspace_id, Window.user_id == user_id]
    if device_id is not None:
        conditions.append(Window.device_id == device_id)
    await team_collect.close_windows(db, reason, team_collect.utcnow(), *conditions)
    await db.commit()


@router.get(
    "/{workspace_id}/collect/windows/{window_id}/sessions", response_model=list[SessionDetail]
)
async def window_sessions(
    workspace_id: str,
    window_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> list[SessionDetail]:
    """끝날 때 돌아보기 — 그 창의 방문으로 만들어지거나 이어진 내 세션."""
    await _member_or_404(db, workspace_id, user_id)
    window = await db.get(Window, window_id)
    if window is None or window.user_id != user_id or window.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="수집 창을 찾을 수 없습니다")
    return await _own_sessions(db, await team_collect.window_session_ids(db, user_id, window_id))


@router.post(
    "/{workspace_id}/collect/windows/{window_id}/withdraw", response_model=WithdrawResponse
)
async def withdraw_window(
    workspace_id: str,
    window_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> WithdrawResponse:
    await _member_or_404(db, workspace_id, user_id)
    try:
        count = await team_collect.withdraw(db, workspace_id, user_id, window_id, team_collect.utcnow())
    except CollectError as exc:
        _raise(exc)
    session_ids = await team_collect.window_session_ids(db, user_id, window_id)
    await db.commit()
    return WithdrawResponse(
        withdrawn_events=count, sessions=await _own_sessions(db, session_ids), window_closed=True
    )


@router.post("/{workspace_id}/collect/sessions/{session_id}/restore", status_code=204)
async def restore_session(
    workspace_id: str,
    session_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> None:
    await _member_or_404(db, workspace_id, user_id)
    try:
        await team_collect.restore(db, workspace_id, user_id, session_id)
    except CollectError as exc:
        _raise(exc)
    await db.commit()
    await set_stream_payload([session_id], workspace_id)
