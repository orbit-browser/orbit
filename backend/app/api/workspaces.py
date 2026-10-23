"""팀 워크스페이스 API (docs/api-design-v2.md §14).

권한 규칙:
- 멤버가 아니면 그 팀은 존재하지 않는 것처럼 404 — 403은 그 id의 존재를 알려준다.
- 멤버가 owner 전용 작업을 하면 403 — 멤버는 이미 팀의 존재를 안다.
- 공유는 자기 세션만, 공유 해제는 공유한 사람 또는 owner.
"""

import hashlib
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import Session as SessionModel
from ..db.models import User, Workspace, WorkspaceMember, WorkspaceSession
from ..db.models import WorkspaceCollectWindow
from ..db.session import get_db
from ..db.vector import set_stream_payload
from ..schemas.workspace import (
    CollectWindowItem,
    CreateWorkspaceRequest,
    InviteCodeResponse,
    JoinWorkspaceRequest,
    MemberBrief,
    ShareResult,
    SharedSessionIds,
    ShareSessionsRequest,
    UpdateWorkspaceRequest,
    WorkspaceItem,
    WorkspaceMemberItem,
    WorkspaceSessionItem,
)
from ..services import team_collect
from ..services.workspaces import (
    INVITE_TTL,
    get_member,
    hash_invite_code,
    new_invite_code,
    shared_session_ids,
    session_scope_clause,
    sharer_is_member,
)
from .deps import current_user_id
from .folders import default_hue
from .sessions import _to_detail

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/workspaces", tags=["workspaces"])

_NOT_FOUND = "팀을 찾을 수 없습니다"


async def _member_or_404(db: AsyncSession, workspace_id: str, user_id: str) -> WorkspaceMember:
    member = await get_member(db, workspace_id, user_id)
    if member is None:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    return member


async def _owner_or_403(db: AsyncSession, workspace_id: str, user_id: str) -> WorkspaceMember:
    member = await _member_or_404(db, workspace_id, user_id)
    if member.role != "owner":
        raise HTTPException(status_code=403, detail="팀 소유자만 할 수 있습니다")
    return member


async def team_shared_ids(db: AsyncSession, user_id: str, workspace_id: str | None) -> list[str] | None:
    """검색·Ask 범위. workspace_id 가 없으면 None(개인 범위), 있으면 그 팀 공유 세션 id.

    멤버가 아니면 404 — 남의 팀 id 로 그 팀의 기록을 검색해 갈 수 있으면 안 된다.
    """
    if workspace_id is None:
        return None
    await _member_or_404(db, workspace_id, user_id)
    return await shared_session_ids(db, workspace_id)


async def _member_counts(db: AsyncSession, workspace_ids: list[str]) -> dict[str, int]:
    if not workspace_ids:
        return {}
    result = await db.execute(
        select(WorkspaceMember.workspace_id, func.count())
        .where(WorkspaceMember.workspace_id.in_(workspace_ids))
        .group_by(WorkspaceMember.workspace_id)
    )
    return {workspace_id: count for workspace_id, count in result.all()}


def window_item(window: WorkspaceCollectWindow) -> CollectWindowItem:
    return CollectWindowItem(
        window_id=window.id,
        workspace_id=window.workspace_id,
        device_id=window.device_id,
        started_at=team_collect._aware(window.started_at).isoformat(),
        expires_at=team_collect._aware(window.expires_at).isoformat(),
    )


def _to_item(
    workspace: Workspace,
    role: str,
    member_count: int,
    my_collect: WorkspaceCollectWindow | None = None,
) -> WorkspaceItem:
    return WorkspaceItem(
        workspace_id=workspace.id,
        name=workspace.name,
        hue=workspace.hue,
        role=role,  # type: ignore[arg-type]
        member_count=member_count,
        created_at=workspace.created_at.isoformat(),
        collect_allowed=bool(workspace.collect_allowed),
        my_collect=window_item(my_collect) if my_collect else None,
    )


async def _item(db: AsyncSession, workspace: Workspace, role: str) -> WorkspaceItem:
    counts = await _member_counts(db, [workspace.id])
    return _to_item(workspace, role, counts.get(workspace.id, 0))


# ── 워크스페이스 ──────────────────────────────────────────


@router.get("", response_model=list[WorkspaceItem])
async def list_workspaces(
    device_id: str | None = Query(None, min_length=1, max_length=64, description="이 기기의 수집 창을 my_collect 로"),
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> list[WorkspaceItem]:
    result = await db.execute(
        select(Workspace, WorkspaceMember.role)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(WorkspaceMember.user_id == user_id)
        .order_by(Workspace.created_at)
    )
    rows = result.all()
    counts = await _member_counts(db, [workspace.id for workspace, _role in rows])
    collecting: dict[str, WorkspaceCollectWindow] = {}
    if device_id is not None:
        windows = await team_collect.active_windows(
            db,
            team_collect.utcnow(),
            WorkspaceCollectWindow.user_id == user_id,
            WorkspaceCollectWindow.device_id == device_id,
        )
        collecting = {w.workspace_id: w for w in windows}
    return [
        _to_item(workspace, role, counts.get(workspace.id, 0), collecting.get(workspace.id))
        for workspace, role in rows
    ]


@router.post("", response_model=WorkspaceItem, status_code=201)
async def create_workspace(
    body: CreateWorkspaceRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> WorkspaceItem:
    """만든 사람이 owner 가 된다. 색은 폴더와 같은 팔레트에서 내 팀 수만큼 돌려 배정한다."""
    joined = await db.scalar(
        select(func.count()).select_from(WorkspaceMember).where(WorkspaceMember.user_id == user_id)
    )
    workspace = Workspace(name=body.name, hue=default_hue(joined or 0))
    db.add(workspace)
    await db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user_id, role="owner"))
    await db.commit()
    await db.refresh(workspace)
    return _to_item(workspace, "owner", 1)


@router.post("/join", response_model=WorkspaceItem)
async def join_workspace(
    body: JoinWorkspaceRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> WorkspaceItem:
    """초대 코드로 참여한다. 이미 멤버면 아무것도 바꾸지 않고 그 팀을 돌려준다."""
    workspace = await db.scalar(
        select(Workspace).where(
            Workspace.invite_code_hash == hash_invite_code(body.code),
            Workspace.invite_expires_at > datetime.now(timezone.utc),
        )
    )
    if workspace is None:
        # 없는 코드·만료·재발급으로 무효가 된 코드를 구분하지 않는다 — 코드 추측에 단서를 주지 않는다.
        raise HTTPException(status_code=400, detail="유효하지 않거나 만료된 초대 코드입니다")

    member = await get_member(db, workspace.id, user_id)
    if member is None:
        member = WorkspaceMember(workspace_id=workspace.id, user_id=user_id, role="member")
        db.add(member)
        await db.commit()
        logger.info("팀 참여 (workspace_id=%s)", workspace.id)
    return await _item(db, workspace, member.role)


@router.patch("/{workspace_id}", response_model=WorkspaceItem)
async def update_workspace(
    workspace_id: str,
    body: UpdateWorkspaceRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> WorkspaceItem:
    await _owner_or_403(db, workspace_id, user_id)
    if body.collect_allowed is False:
        # 창을 먼저 잠가 닫는다 — 진행 중인 인제스트가 끝난 뒤 닫혀, 그 뒤 도착하는 방문은 개인이 된다.
        await team_collect.close_windows(
            db, "disallowed", team_collect.utcnow(), WorkspaceCollectWindow.workspace_id == workspace_id
        )
    workspace = await db.get(Workspace, workspace_id)
    if body.name is not None:
        workspace.name = body.name
    if body.collect_allowed is not None:
        workspace.collect_allowed = body.collect_allowed
    await db.commit()
    await db.refresh(workspace)
    return await _item(db, workspace, "owner")


@router.delete("/{workspace_id}", status_code=204)
async def delete_workspace(
    workspace_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> None:
    """팀과 멤버십·공유 관계만 지운다. 공유됐던 원본 세션은 각자의 개인 기록에 그대로 남는다.

    팀 수집 스트림을 먼저 푼다(창 잠금 → 방문 표시 → 세션 스트림, docs/team-collect-mode.md §6.3).
    """
    await _owner_or_403(db, workspace_id, user_id)
    cleared = await team_collect.release_stream(
        db, workspace_id, None, "team_deleted", team_collect.utcnow()
    )
    await db.execute(delete(WorkspaceSession).where(WorkspaceSession.workspace_id == workspace_id))
    await db.execute(
        delete(WorkspaceCollectWindow).where(WorkspaceCollectWindow.workspace_id == workspace_id)
    )
    await db.execute(delete(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace_id))
    await db.execute(delete(Workspace).where(Workspace.id == workspace_id))
    await db.commit()
    await set_stream_payload(cleared, None)


@router.post("/{workspace_id}/invite-code", response_model=InviteCodeResponse)
async def issue_invite_code(
    workspace_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> InviteCodeResponse:
    """새 초대 코드를 발급한다. 이전 코드는 즉시 무효가 된다(유출 시 재발급으로 막는다)."""
    await _owner_or_403(db, workspace_id, user_id)
    workspace = await db.get(Workspace, workspace_id)
    code, code_hash = new_invite_code()
    expires_at = datetime.now(timezone.utc) + INVITE_TTL
    workspace.invite_code_hash = code_hash
    workspace.invite_expires_at = expires_at
    await db.commit()
    return InviteCodeResponse(code=code, expires_at=expires_at.isoformat())


# ── 멤버 ──────────────────────────────────────────────


@router.get("/{workspace_id}/members", response_model=list[WorkspaceMemberItem])
async def list_members(
    workspace_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> list[WorkspaceMemberItem]:
    """이메일은 owner 와 본인에게만 준다 — 초대 코드가 퍼지면 모르는 사람도 멤버가 될 수 있다."""
    requester = await _member_or_404(db, workspace_id, user_id)
    result = await db.execute(
        select(WorkspaceMember, User)
        .join(User, User.id == WorkspaceMember.user_id)
        .where(WorkspaceMember.workspace_id == workspace_id)
        # owner 를 맨 위에, 나머지는 참여 순
        .order_by((WorkspaceMember.role != "owner"), WorkspaceMember.joined_at)
    )
    return [
        WorkspaceMemberItem(
            user_id=member.user_id,
            name=user.name,
            email=user.email if requester.role == "owner" or member.user_id == user_id else None,
            picture=user.picture,
            role=member.role,  # type: ignore[arg-type]
            joined_at=member.joined_at.isoformat(),
        )
        for member, user in result.all()
    ]


@router.delete("/{workspace_id}/members/{member_user_id}", status_code=204)
async def remove_member(
    workspace_id: str,
    member_user_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> None:
    """owner 가 멤버를 내보내거나, 멤버가 스스로 탈퇴한다.

    나간 사람이 그 팀에 건 공유는 모두 풀리고 개인 세션은 그대로 남는다. owner 는 탈퇴할 수
    없다 — 소유권 이전이 없는 1단계에서 owner 가 나가면 아무도 관리할 수 없는 팀이 남는다.
    owner 가 내보내면 현재 초대 코드도 무효가 된다(필요하면 새로 발급한다).
    """
    requester = await _member_or_404(db, workspace_id, user_id)
    if member_user_id == user_id:
        if requester.role == "owner":
            raise HTTPException(
                status_code=409, detail="소유자는 탈퇴할 수 없습니다. 팀을 삭제해 주세요"
            )
        target = requester
    else:
        if requester.role != "owner":
            raise HTTPException(status_code=403, detail="팀 소유자만 할 수 있습니다")
        target = await get_member(db, workspace_id, member_user_id)
        if target is None:
            raise HTTPException(status_code=404, detail="멤버를 찾을 수 없습니다")

    # 팀 수집 스트림을 공유 행보다 먼저 푼다(창 잠금 → 방문 표시 → 세션 스트림). 다시 들어와도 옛 창은
    # 가입 시각 조건으로 무효다.
    cleared = await team_collect.release_stream(
        db,
        workspace_id,
        target.user_id,
        "left" if target.user_id == user_id else "removed",
        team_collect.utcnow(),
    )
    await db.execute(
        delete(WorkspaceSession).where(
            WorkspaceSession.workspace_id == workspace_id,
            WorkspaceSession.shared_by == target.user_id,
        )
    )
    if target.user_id != user_id:
        # 내보낸 사람이 아직 유효한 같은 코드로 다시 들어오지 못하게 현재 초대 코드를 무효로 한다.
        workspace = await db.get(Workspace, workspace_id)
        workspace.invite_code_hash = None
        workspace.invite_expires_at = None
    await db.delete(target)
    await db.commit()
    await set_stream_payload(cleared, None)


# ── 공유 세션 ──────────────────────────────────────────


@router.get("/{workspace_id}/sessions", response_model=list[WorkspaceSessionItem])
async def list_workspace_sessions(
    workspace_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> list[WorkspaceSessionItem]:
    """팀에 공유된 세션을 최근 활동순으로. 병합으로 흡수된 세션은 빠진다(되돌리면 다시 보인다)."""
    await _member_or_404(db, workspace_id, user_id)
    result = await db.execute(
        select(SessionModel, WorkspaceSession, User)
        .join(WorkspaceSession, WorkspaceSession.session_id == SessionModel.id)
        .join(WorkspaceMember, sharer_is_member())
        .outerjoin(User, User.id == WorkspaceSession.shared_by)
        .where(WorkspaceSession.workspace_id == workspace_id, SessionModel.status != "merged")
        .order_by(func.coalesce(SessionModel.last_activity_at, SessionModel.created_at).desc())
    )
    return [
        WorkspaceSessionItem(
            **_to_detail(session, include_private=False).model_dump(),
            shared_by=MemberBrief(
                user_id=share.shared_by,
                name=user.name if user else None,
                picture=user.picture if user else None,
            ),
            shared_at=share.shared_at.isoformat(),
            collected=session.collect_workspace_id == workspace_id,
        )
        for session, share, user in result.all()
    ]


@router.get("/{workspace_id}/sessions/ids", response_model=SharedSessionIds)
async def list_workspace_session_ids(
    workspace_id: str,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> SharedSessionIds | Response:
    """지금 그 팀에 보이는 공유 세션 id 만. 열린 새 탭이 공유 해제를 비추려고 몇 초마다 부른다.

    범위는 팀 검색·Ask 와 같은 SQL 조건(session_scope_clause)이라 탈퇴·공유 해제가 바로 빠진다.
    목록이 그대로면 If-None-Match 로 304 를 돌려 본문을 보내지 않는다. ETag 는 정렬한 id 목록의 해시다.
    """
    await _member_or_404(db, workspace_id, user_id)
    ids = sorted(
        (
            await db.execute(
                select(SessionModel.id).where(session_scope_clause(user_id, workspace_id))
            )
        ).scalars().all()
    )
    etag = '"' + hashlib.sha256("\n".join(ids).encode()).hexdigest()[:32] + '"'
    # 응답을 중간 캐시에 두지 않고, 매번 서버에 다시 묻게 한다(공유 해제를 늦게 비추면 안 된다).
    headers = {"ETag": etag, "Cache-Control": "private, no-cache"}
    if etag in (request.headers.get("if-none-match") or "").split(", "):
        return Response(status_code=304, headers=headers)
    response.headers.update(headers)
    return SharedSessionIds(session_ids=ids)


@router.post("/{workspace_id}/sessions", response_model=ShareResult)
async def share_sessions(
    workspace_id: str,
    body: ShareSessionsRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> ShareResult:
    """내 세션을 팀에 공유한다. 사본이 아니라 원본을 가리키므로 이후 추가되는 페이지도 팀에 보인다."""
    await _member_or_404(db, workspace_id, user_id)

    requested = list(dict.fromkeys(body.session_ids))
    owned = set(
        (
            await db.execute(
                select(SessionModel.id).where(
                    SessionModel.user_id == user_id,
                    SessionModel.id.in_(requested),
                    SessionModel.status != "merged",
                )
            )
        )
        .scalars()
        .all()
    )
    already = set(
        (
            await db.execute(
                select(WorkspaceSession.session_id).where(
                    WorkspaceSession.workspace_id == workspace_id,
                    WorkspaceSession.session_id.in_(owned),
                )
            )
        )
        .scalars()
        .all()
    )

    shared = [session_id for session_id in requested if session_id in owned]
    skipped = [session_id for session_id in requested if session_id not in owned]
    new_ids = [session_id for session_id in shared if session_id not in already]
    if new_ids:
        db.add_all(
            WorkspaceSession(workspace_id=workspace_id, session_id=session_id, shared_by=user_id)
            for session_id in new_ids
        )
        await db.commit()
    if skipped:
        logger.info("세션 공유에서 %d건 건너뜀 (workspace_id=%s)", len(skipped), workspace_id)

    return ShareResult(workspace_id=workspace_id, shared=shared, skipped=skipped)


@router.delete("/{workspace_id}/sessions/{session_id}", status_code=204)
async def unshare_session(
    workspace_id: str,
    session_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> None:
    member = await _member_or_404(db, workspace_id, user_id)
    share = await db.get(WorkspaceSession, (workspace_id, session_id))
    if share is None:
        raise HTTPException(status_code=404, detail="공유된 세션을 찾을 수 없습니다")
    if share.shared_by != user_id and member.role != "owner":
        raise HTTPException(status_code=403, detail="공유한 사람이나 팀 소유자만 해제할 수 있습니다")
    # 공유 해제 = 스트림 해제(docs/team-collect-mode.md §3.3). 누가 풀든 이 팀의 수집 세션이면 스트림도 비워,
    # 이후 팀 방문이 팀에 보이지 않는 세션에 붙거나 스트림이 다른 세션과 자동병합되지 않게 한다.
    session = await db.get(SessionModel, session_id)
    cleared = session is not None and session.collect_workspace_id == workspace_id
    if cleared:
        session.collect_workspace_id = None
    await db.delete(share)
    await db.commit()
    if cleared:
        await set_stream_payload([session_id], None)
