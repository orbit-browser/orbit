from pydantic import BaseModel


class AppSettingsResponse(BaseModel):
    """사용자가 토글할 수 있는 앱 설정 (docs/merge-design.md — 자동병합 UI 토글)."""

    auto_merge_enabled: bool
    # 배치 끝 폴더 자동 배정(docs/api-design-v2.md §13.4). 제안은 이 설정과 무관하게 보인다.
    auto_folder_enabled: bool


class UpdateSettingsRequest(BaseModel):
    """부분 갱신 — 전달된 필드만 반영한다."""

    auto_merge_enabled: bool | None = None
    auto_folder_enabled: bool | None = None
