"""사용자 폴더 스키마 (docs/api-design-v2.md §13).

폴더는 사용자가 직접 만드는 세션 그룹이다. 자동 분류가 아니므로 서버가 이름을
지어내거나 소속을 추론하지 않는다.
"""

from pydantic import BaseModel, Field

# ── 요청 ──────────────────────────────────────────────


class CreateFolderRequest(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class UpdateFolderRequest(BaseModel):
    """부분 갱신 — None 인 필드는 건드리지 않는다."""

    name: str | None = Field(default=None, min_length=1, max_length=60)
    hue: str | None = Field(default=None, max_length=20)
    position: int | None = Field(default=None, ge=0)


class AssignSessionsRequest(BaseModel):
    """세션 일괄 배정. 드래그 한 개도 같은 경로를 쓴다 — 계약을 둘로 나누지 않는다."""

    session_ids: list[str] = Field(min_length=1, max_length=200)


# ── 응답 ──────────────────────────────────────────────


class FolderItem(BaseModel):
    folder_id: str
    name: str
    hue: str
    position: int
    session_count: int
    created_at: str
    updated_at: str


class AssignResult(BaseModel):
    """어떤 세션이 실제로 옮겨졌는지 그대로 돌려준다.

    존재하지 않거나 남의 세션 id가 섞여도 요청 전체를 실패시키지 않는다 —
    일괄 배정에서 한 건 때문에 나머지가 통째로 취소되면 사용자가 원인을 알 수 없다.
    대신 건너뛴 id를 명시해 클라이언트가 표시할 수 있게 한다.
    """

    folder_id: str
    assigned: list[str]
    skipped: list[str]
