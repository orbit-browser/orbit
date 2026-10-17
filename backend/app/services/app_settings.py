"""사용자별 설정 저장소 (key-value, 런타임에 사용자가 토글하는 선호값).

env(config)는 기본값, user_settings 테이블 값이 있으면 우선한다. 현재 auto_merge_enabled만 사용.
"""

from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db.models import UserSetting
from ..db.session import AsyncSessionLocal

AUTO_MERGE_KEY = "auto_merge_enabled"


async def get_bool(db: AsyncSession, user_id: str, key: str, default: bool) -> bool:
    """저장된 bool 설정을 읽는다. 없거나 형식이 다르면 default."""
    row = await db.get(UserSetting, (user_id, key))
    if row is None or not isinstance(row.value, bool):
        return default
    return row.value


async def set_bool(db: AsyncSession, user_id: str, key: str, value: bool) -> None:
    """bool 설정을 upsert(commit은 이 함수가 수행)."""
    row = await db.get(UserSetting, (user_id, key))
    if row is None:
        db.add(UserSetting(user_id=user_id, key=key, value=value))
    else:
        row.value = value
    await db.commit()


async def is_auto_merge_enabled(user_id: str) -> bool:
    """그 사용자의 자동 병합 활성 여부 — DB 값 우선, 없으면 env 기본값(settings.auto_merge_enabled)."""
    async with AsyncSessionLocal() as db:
        return await get_bool(db, user_id, AUTO_MERGE_KEY, settings.auto_merge_enabled)
