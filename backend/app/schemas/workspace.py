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
    """부분 갱신 — 보낸 필드만 바꾼다. collect_allowed 를 끄면 그 팀의 열린 수집 창이 모두 끝난다."""

    name: WorkspaceName | None = None
    collect_allowed: bool | None = None


class JoinWorkspaceRequest(BaseModel):
    # 메신저에서 복사하면 앞뒤 공백·줄바꿈이 섞여 온다.
    code: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]


class ShareSessionsRequest(BaseModel):
    session_ids: list[str] = Field(min_length=1, max_length=200)


DeviceId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
# 수집 창 길이(분). 최대 8시간 — 무기한 켜기는 없다(docs/team-collect-mode.md §1.3).
CollectDuration = Literal[30, 60, 120, 240, 480]
StopReason = Literal["stop", "pause", "browser_restart", "account_switch"]


class StartCollectRequest(BaseModel):
    device_id: DeviceId
    duration_minutes: CollectDuration = 120
    # 확장이 보여 준 팀 수집 동의 문구의 버전. user_settings 에 기록한다(§7.2).
    consent_version: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=32)]


# ── 응답 ──────────────────────────────────────────────


class CollectWindowItem(BaseModel):
    window_id: str
    workspace_id: str
    device_id: str
    started_at: str
    expires_at: str


class WorkspaceItem(BaseModel):
    workspace_id: str
    name: str
    hue: str
    role: WorkspaceRole
    member_count: int
    created_at: str
    collect_allowed: bool = False
    # 이 기기(`GET /workspaces?device_id=`)의 활성 수집 창. device_id 를 주지 않으면 항상 null.
    my_collect: CollectWindowItem | None = None


class CollectingMember(BaseModel):
    user_id: str
    name: str | None = None
    picture: str | None = None
    expires_at: str


class CollectStatusResponse(BaseModel):
    allowed: bool
    # 이 팀에 대한 내 모든 기기의 활성 창(다른 기기에서 켠 것을 끄기 위해, S3).
    my_windows: list[CollectWindowItem]
    # 지금 이 팀으로 수집 중인 멤버. 남의 기기 정보는 싣지 않는다.
    collecting: list[CollectingMember]


class StartCollectResponse(BaseModel):
    window: CollectWindowItem
    # 확장이 기기 시계 차이를 보정하는 기준(S1). 서버 판정을 대신하지 않는다.
    server_now: str
    # 같은 기기에서 다른 팀 수집이 켜져 있었다면 그 팀 id(이번 시작으로 끝났다).
    ended_workspace_id: str | None = None


class WithdrawResponse(BaseModel):
    # 세션에 묶이기 전이라 개인으로 돌린 방문 수.
    withdrawn_events: int
    # 이미 세션이 된 이 창의 내 세션 — 돌아보기 목록을 갱신해 세션별로 뺄 수 있게 한다.
    sessions: list[SessionDetail]
    # 이 창이 지금 끝난 상태인가. 열린 창을 빼면 창도 함께 끝낸다(S'3).
    window_closed: bool


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
    # 이 팀의 수집 창 방문으로 만들어진 세션인가(수동 공유와 구분해 표시한다).
    collected: bool = False


class SharedSessionIds(BaseModel):
    """지금 그 팀에 보이는 공유 세션 id(정렬). 팀 목록과 같은 범위의 가벼운 판."""

    session_ids: list[str]


class ShareResult(BaseModel):
    """폴더 배정(`AssignResult`)과 같은 규칙 — 남의·없는 세션이 섞여도 전체를 실패시키지 않고
    건너뛴 id를 돌려준다. 이미 공유된 세션은 `shared` 에 그대로 포함된다(멱등)."""

    workspace_id: str
    shared: list[str]
    skipped: list[str]
