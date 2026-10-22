from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db.session import get_db
from ..schemas.settings import AppSettingsResponse, UpdateSettingsRequest
from ..db.models import UserSetting
from ..services.app_settings import AUTO_FOLDER_KEY, AUTO_MERGE_KEY, get_bool, set_bool
from ..services.team_collect import EXCLUDED_DOMAINS_KEY, excluded_domains
from .deps import current_user_id

router = APIRouter(prefix="/settings", tags=["settings"])


async def _current(db: AsyncSession, user_id: str) -> AppSettingsResponse:
    return AppSettingsResponse(
        auto_merge_enabled=await get_bool(db, user_id, AUTO_MERGE_KEY, settings.auto_merge_enabled),
        auto_folder_enabled=await get_bool(db, user_id, AUTO_FOLDER_KEY, settings.auto_folder_enabled),
        team_collect_excluded_domains=await excluded_domains(db, user_id),
    )


@router.get("", response_model=AppSettingsResponse)
async def get_settings(
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> AppSettingsResponse:
    """사용자 토글 가능한 앱 설정 조회. 그 사용자의 DB 값 우선, 없으면 env 기본값."""
    return await _current(db, user_id)


@router.patch("", response_model=AppSettingsResponse)
async def update_settings(
    body: UpdateSettingsRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> AppSettingsResponse:
    """전달된 설정만 갱신. 자동 병합은 파괴적 기능이라 사용자가 명시적으로 켤 때만 활성화된다."""
    if body.auto_merge_enabled is not None:
        await set_bool(db, user_id, AUTO_MERGE_KEY, body.auto_merge_enabled)
    if body.auto_folder_enabled is not None:
        await set_bool(db, user_id, AUTO_FOLDER_KEY, body.auto_folder_enabled)
    if body.team_collect_excluded_domains is not None:
        # 같은 계정의 다른 기기와 맞추고, 서버 인제스트 판정도 이 목록을 본다(docs/team-collect-mode.md §4.4).
        domains = list(dict.fromkeys(d.strip(".") for d in body.team_collect_excluded_domains if d.strip(".")))
        row = await db.get(UserSetting, (user_id, EXCLUDED_DOMAINS_KEY))
        if row is None:
            db.add(UserSetting(user_id=user_id, key=EXCLUDED_DOMAINS_KEY, value=domains))
        else:
            row.value = domains
        await db.commit()
    return await _current(db, user_id)
