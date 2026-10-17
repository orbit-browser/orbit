"""팀 워크스페이스 스키마 (docs/api-design-v2.md §14).

1단계는 세션 공유형이다. 팀원은 공유된 세션을 읽고 검색·Ask만 하며, 세션을 고치는 일은
소유자만 한다.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

from .session import SessionDetail

WorkspaceRole = Literal["owner", "member"]

# 앞뒤 공백을 먼저 지운 뒤 길이를 잰다 — 공백이 섞여 61자가 된 이름을 거절하지 않게.
WorkspaceName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]

# ── 요청 ──────────────────────────────────────────────


class CreateWorkspaceRequest(BaseModel):
    name: WorkspaceName


class UpdateWorkspaceRequest(BaseModel):
    name: WorkspaceName


class JoinWorkspaceRequest(BaseModel):
    # 메신저에서 복사하면 앞뒤 공백·줄바꿈이 섞여 온다.
    code: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]


class ShareSessionsRequest(BaseModel):
    session_ids: list[str] = Field(min_length=1, max_length=200)


# ── 응답 ──────────────────────────────────────────────


class WorkspaceItem(BaseModel):
    workspace_id: str
    name: str
    hue: str
    role: WorkspaceRole
    member_count: int
    created_at: str


class WorkspaceMemberItem(BaseModel):
    user_id: str
    name: str | None = None
    # owner 와 본인에게만 채워진다. 다른 멤버에게는 null.
    email: str | None = None
    picture: str | None = None
    role: WorkspaceRole
    joined_at: str


class InviteCodeResponse(BaseModel):
    """초대 코드는 발급 응답에서 한 번만 보인다 — 서버는 해시만 저장한다."""

    code: str
    expires_at: str


class MemberBrief(BaseModel):
    user_id: str
    name: str | None = None
    picture: str | None = None


class WorkspaceSessionItem(SessionDetail):
    """팀에 공유된 세션. `folder_id` 는 소유자 개인 폴더라 팀 화면에서는 쓰지 않는다."""

    shared_by: MemberBrief
    shared_at: str


class ShareResult(BaseModel):
    """폴더 배정(`AssignResult`)과 같은 규칙 — 남의·없는 세션이 섞여도 전체를 실패시키지 않고
    건너뛴 id를 돌려준다. 이미 공유된 세션은 `shared` 에 그대로 포함된다(멱등)."""

    workspace_id: str
    shared: list[str]
    skipped: list[str]
