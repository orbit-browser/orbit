"""사용자 폴더 라우터 (docs/api-design-v2.md §13).

세션은 폴더 하나에만 속한다. 배정은 이동이며, 다른 폴더에 있던 세션도 그대로 옮겨온다.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import Folder, Session as SessionModel
from ..db.session import get_db
from ..schemas.folder import (
    AssignResult,
    AssignSessionsRequest,
    CreateFolderRequest,
    FolderItem,
    UpdateFolderRequest,
)
from .deps import current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/folders", tags=["folders"])

# 캔버스 궤도 색과 같은 팔레트 (extension .../atlas/data.ts SESSION_HUES).
# 폴더마다 다른 색이 나오도록 생성 순서로 순환 배정한다.
_HUE_PALETTE = ("#ef6f47", "#e09528", "#7fa452", "#3aa09a", "#727bcb", "#c06aa2")

# 병합으로 흡수된 세션은 목록에 나오지 않으므로 폴더 개수에서도 뺀다.
_LIVE_SESSION = SessionModel.status != "merged"


def default_hue(position: int) -> str:
    """생성 순서로 팔레트를 순환한다. 음수 position 도 안전하게 감싼다."""
    return _HUE_PALETTE[position % len(_HUE_PALETTE)]


def _to_item(folder: Folder, session_count: int) -> FolderItem:
    return FolderItem(
        folder_id=folder.id,
        name=folder.name,
        hue=folder.hue,
        position=folder.position,
        session_count=session_count,
        created_at=folder.created_at.isoformat(),
        updated_at=folder.updated_at.isoformat(),
    )


async def _owned_folder(db: AsyncSession, folder_id: str, user_id: str) -> Folder:
    """남의 폴더에는 403이 아니라 404 — 403은 그 id의 존재를 알려준다(sessions.py 와 동일 정책)."""
    folder = await db.get(Folder, folder_id)
    if not folder or folder.user_id != user_id:
        raise HTTPException(status_code=404, detail="폴더를 찾을 수 없습니다")
    return folder


async def _count_by_folder(db: AsyncSession, user_id: str) -> dict[str, int]:
    result = await db.execute(
        select(SessionModel.folder_id, func.count())
        .where(
            SessionModel.user_id == user_id,
            SessionModel.folder_id.is_not(None),
            _LIVE_SESSION,
        )
        .group_by(SessionModel.folder_id)
    )
    return {folder_id: count for folder_id, count in result.all()}


@router.get("", response_model=list[FolderItem])
async def list_folders(
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> list[FolderItem]:
    result = await db.execute(
        select(Folder)
        .where(Folder.user_id == user_id)
        .order_by(Folder.position, Folder.created_at)
    )
    counts = await _count_by_folder(db, user_id)
    return [_to_item(folder, counts.get(folder.id, 0)) for folder in result.scalars().all()]


@router.post("", response_model=FolderItem, status_code=201)
async def create_folder(
    body: CreateFolderRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> FolderItem:
    # 새 폴더는 항상 맨 뒤로. 기존 폴더의 position 을 건드리지 않아 순서가 흔들리지 않는다.
    last_position = await db.scalar(
        select(func.max(Folder.position)).where(Folder.user_id == user_id)
    )
    position = 0 if last_position is None else last_position + 1

    folder = Folder(
        user_id=user_id,
        name=body.name.strip(),
        hue=default_hue(position),
        position=position,
    )
    db.add(folder)
    await db.commit()
    await db.refresh(folder)
    return _to_item(folder, 0)


@router.patch("/{folder_id}", response_model=FolderItem)
async def update_folder(
    folder_id: str,
    body: UpdateFolderRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> FolderItem:
    folder = await _owned_folder(db, folder_id, user_id)

    if body.name is not None:
        folder.name = body.name.strip()
    if body.hue is not None:
        folder.hue = body.hue
    if body.position is not None:
        folder.position = body.position

    await db.commit()
    await db.refresh(folder)
    counts = await _count_by_folder(db, user_id)
    return _to_item(folder, counts.get(folder.id, 0))


@router.delete("/{folder_id}", status_code=204)
async def delete_folder(
    folder_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> None:
    """폴더만 지우고 세션은 남긴다 — 정리 도구가 데이터를 지우면 안 된다."""
    folder = await _owned_folder(db, folder_id, user_id)

    await db.execute(
        update(SessionModel)
        .where(SessionModel.user_id == user_id, SessionModel.folder_id == folder_id)
        .values(folder_id=None)
    )
    await db.delete(folder)
    await db.commit()


@router.post("/{folder_id}/sessions", response_model=AssignResult)
async def assign_sessions(
    folder_id: str,
    body: AssignSessionsRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> AssignResult:
    """세션을 이 폴더로 옮긴다. 다른 폴더에 있던 세션도 이동한다(단일 소속)."""
    await _owned_folder(db, folder_id, user_id)

    # 중복 id 는 한 번만 처리하되 요청 순서를 유지한다.
    requested = list(dict.fromkeys(body.session_ids))
    result = await db.execute(
        select(SessionModel.id).where(
            SessionModel.user_id == user_id,
            SessionModel.id.in_(requested),
            _LIVE_SESSION,
        )
    )
    owned = set(result.scalars().all())

    assigned = [session_id for session_id in requested if session_id in owned]
    skipped = [session_id for session_id in requested if session_id not in owned]

    if assigned:
        await db.execute(
            update(SessionModel)
            .where(SessionModel.user_id == user_id, SessionModel.id.in_(assigned))
            .values(folder_id=folder_id)
        )
        await db.commit()

    if skipped:
        logger.info("폴더 배정에서 %d건 건너뜀 (folder_id=%s)", len(skipped), folder_id)

    return AssignResult(folder_id=folder_id, assigned=assigned, skipped=skipped)


@router.delete("/{folder_id}/sessions/{session_id}", status_code=204)
async def remove_session(
    folder_id: str,
    session_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> None:
    """세션을 폴더에서 빼 미정리로 되돌린다."""
    await _owned_folder(db, folder_id, user_id)

    session = await db.get(SessionModel, session_id)
    if not session or session.user_id != user_id:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    if session.folder_id != folder_id:
        raise HTTPException(status_code=404, detail="이 폴더에 없는 세션입니다")

    session.folder_id = None
    await db.commit()
