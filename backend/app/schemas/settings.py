from pydantic import BaseModel


class AppSettingsResponse(BaseModel):
    """사용자가 토글할 수 있는 앱 설정 (docs/merge-design.md — 자동병합 UI 토글)."""

    auto_merge_enabled: bool


class UpdateSettingsRequest(BaseModel):
    """부분 갱신 — 전달된 필드만 반영한다."""

    auto_merge_enabled: bool | None = None
