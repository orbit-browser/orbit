from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints

# 호스트 접미사 일치(예: "example.com" 은 "a.example.com" 도 뺀다). 소문자로 접는다.
ExcludedDomain = Annotated[
    str, StringConstraints(strip_whitespace=True, to_lower=True, min_length=1, max_length=253)
]


class AppSettingsResponse(BaseModel):
    """사용자가 토글할 수 있는 앱 설정 (docs/merge-design.md — 자동병합 UI 토글)."""

    auto_merge_enabled: bool
    # 배치 끝 폴더 자동 배정(docs/api-design-v2.md §13.4). 제안은 이 설정과 무관하게 보인다.
    auto_folder_enabled: bool
    # 팀 수집에서 뺄 사이트(docs/team-collect-mode.md §4.4). 기본 제외(웹메일·메신저·검색 결과)는 코드 상수라 여기 없다.
    team_collect_excluded_domains: list[str] = []


class UpdateSettingsRequest(BaseModel):
    """부분 갱신 — 전달된 필드만 반영한다."""

    auto_merge_enabled: bool | None = None
    auto_folder_enabled: bool | None = None
    team_collect_excluded_domains: list[ExcludedDomain] | None = Field(default=None, max_length=200)
