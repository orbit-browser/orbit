from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db.session import get_db
from ..schemas.settings import AppSettingsResponse, UpdateSettingsRequest
from ..services.app_settings import AUTO_MERGE_KEY, get_bool, set_bool

router = APIRouter(prefix="/settings", tags=["settings"])


async def _current(db: AsyncSession) -> AppSettingsResponse:
    return AppSettingsResponse(
        auto_merge_enabled=await get_bool(db, AUTO_MERGE_KEY, settings.auto_merge_enabled),
    )


@router.get("", response_model=AppSettingsResponse)
async def get_settings(db: AsyncSession = Depends(get_db)) -> AppSettingsResponse:
    """사용자 토글 가능한 앱 설정 조회. DB 값 우선, 없으면 env 기본값."""
    return await _current(db)


@router.patch("", response_model=AppSettingsResponse)
async def update_settings(
    body: UpdateSettingsRequest,
    db: AsyncSession = Depends(get_db),
) -> AppSettingsResponse:
    """전달된 설정만 갱신. 자동 병합은 파괴적 기능이라 사용자가 명시적으로 켤 때만 활성화된다."""
    if body.auto_merge_enabled is not None:
        await set_bool(db, AUTO_MERGE_KEY, body.auto_merge_enabled)
    return await _current(db)
