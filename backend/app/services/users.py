"""사용자 조회·생성과 기존 로컬 데이터 귀속.

가입과 로그인을 따로 두지 않는다 — 구글 계정으로 처음 들어오면 그 순간이 가입이고,
그 뒤로는 같은 `google_sub` 로 같은 사용자를 찾는다.
"""

import logging
from datetime import datetime, timezone

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import ExplorationEvent, Session, SyncBatch, User
from .google_auth import GoogleIdentity

logger = logging.getLogger(__name__)

# 인증 도입 전 쌓인 데이터가 달고 있는 소유자 값 (docs/data-model-v2.md §4)
LEGACY_USER_ID = "local"


async def get_or_create_user(db: AsyncSession, identity: GoogleIdentity) -> tuple[User, bool]:
    """구글 계정으로 사용자를 찾거나 만든다. `(사용자, 신규가입여부)` 를 돌려준다.

    매칭 기준은 이메일이 아니라 `google_sub` 다 — 이메일은 바뀔 수 있다.
    """
    existing = await db.scalar(select(User).where(User.google_sub == identity.sub))
    if existing is not None:
        # 이름·사진·이메일은 구글 쪽이 최신이므로 로그인할 때마다 맞춰 둔다.
        existing.email = identity.email
        existing.name = identity.name
        existing.picture = identity.picture
        existing.last_login_at = datetime.now(timezone.utc)
        await db.flush()
        return existing, False

    user = User(
        google_sub=identity.sub,
        email=identity.email,
        name=identity.name,
        picture=identity.picture,
    )
    db.add(user)
    await db.flush()
    return user, True


async def claim_legacy_data(db: AsyncSession, user_id: str) -> int:
    """인증 도입 전 쌓인 `user_id="local"` 데이터를 이 사용자에게 넘긴다.

    **가장 먼저 가입한 사용자 한 명에게만** 적용한다. 그러지 않으면 나중에 로그인한
    다른 계정이 남의 탐색 기록을 가져가게 된다.

    돌려주는 값은 옮긴 행의 총 개수(로그·검증용).
    """
    user_count = await db.scalar(select(func.count()).select_from(User))
    if user_count != 1:
        return 0

    moved = 0
    for model in (Session, ExplorationEvent, SyncBatch):
        result = await db.execute(
            update(model)
            .where(model.user_id == LEGACY_USER_ID)
            .values(user_id=user_id)
        )
        moved += result.rowcount or 0

    if moved:
        logger.info("[auth] 최초 가입자에게 기존 로컬 데이터 %d행을 귀속했습니다", moved)
    return moved
