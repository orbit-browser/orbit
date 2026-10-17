"""팀 워크스페이스 — 멤버십, 공유 범위, 초대 코드.

공유는 원본 세션에 대한 라이브 참조다(`WorkspaceSession`). 다른 사람이 읽을 수 있는 세션은
"그 사람이 멤버인 팀에 공유된 세션"뿐이며, 그 판정은 이 모듈에 모은다.
"""

import hashlib
import secrets
from collections import defaultdict
from datetime import timedelta

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from ..db.models import Session as SessionModel
from ..db.models import WorkspaceMember, WorkspaceSession

INVITE_TTL = timedelta(days=7)


def hash_invite_code(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


def new_invite_code() -> tuple[str, str]:
    """(코드, 해시). 96비트 난수라 대입 공격으로 맞힐 수 없다."""
    code = secrets.token_urlsafe(12)
    return code, hash_invite_code(code)


async def get_member(db: AsyncSession, workspace_id: str, user_id: str) -> WorkspaceMember | None:
    return await db.get(WorkspaceMember, (workspace_id, user_id))


def sharer_is_member(member=WorkspaceMember):
    """공유한 사람이 아직 그 팀 멤버인 공유만 센다(member 를 이 조건으로 조인).

    탈퇴·내보내기는 그 사람의 공유를 지우지만, 같은 순간 들어온 공유 요청이 남을 수 있다.
    읽는 쪽에서 한 번 더 걸러 나간 사람의 세션이 팀에 보이지 않게 한다.
    """
    return and_(
        member.workspace_id == WorkspaceSession.workspace_id,
        member.user_id == WorkspaceSession.shared_by,
    )


async def shared_session_ids(db: AsyncSession, workspace_id: str) -> list[str]:
    """그 팀에 공유된 세션 중 병합으로 흡수되지 않은 것 (팀 검색·Ask 범위)."""
    result = await db.execute(
        select(WorkspaceSession.session_id)
        .join(SessionModel, SessionModel.id == WorkspaceSession.session_id)
        .join(WorkspaceMember, sharer_is_member())
        .where(WorkspaceSession.workspace_id == workspace_id, SessionModel.status != "merged")
    )
    return list(result.scalars().all())


async def is_shared_with(db: AsyncSession, session_id: str, user_id: str) -> bool:
    """그 세션이 user_id 가 멤버인 팀 어디에라도 공유돼 있는가."""
    viewer = aliased(WorkspaceMember)
    sharer = aliased(WorkspaceMember)
    found = await db.scalar(
        select(WorkspaceSession.workspace_id)
        .join(
            viewer,
            and_(viewer.workspace_id == WorkspaceSession.workspace_id, viewer.user_id == user_id),
        )
        .join(sharer, sharer_is_member(sharer))
        .where(WorkspaceSession.session_id == session_id)
        .limit(1)
    )
    return found is not None


async def shared_workspaces(db: AsyncSession, session_ids: list[str]) -> dict[str, list[str]]:
    """세션별로 공유된 팀 id. 공유되지 않은 세션은 키가 없다."""
    if not session_ids:
        return {}
    result = await db.execute(
        select(WorkspaceSession.session_id, WorkspaceSession.workspace_id)
        .join(WorkspaceMember, sharer_is_member())
        .where(WorkspaceSession.session_id.in_(session_ids))
    )
    by_session: dict[str, list[str]] = defaultdict(list)
    for session_id, workspace_id in result.all():
        by_session[session_id].append(workspace_id)
    return dict(by_session)


def session_scope_clause(user_id: str, shared_ids: list[str] | None):
    """검색·Ask가 읽을 세션 조건.

    shared_ids 가 있으면 팀 범위(그 팀에 공유된 세션만), 없으면 요청자 소유 세션이다.
    팀 범위에서도 요청자 자신의 공유 안 된 세션은 섞지 않는다 — 화면이 보여 주는 범위와 같게.
    """
    if shared_ids is not None:
        return SessionModel.id.in_(shared_ids)
    return SessionModel.user_id == user_id
