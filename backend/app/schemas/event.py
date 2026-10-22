import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .session import SessionDetail

# ── 요청 ──────────────────────────────────────────────

# 확장은 실패한 배치를 통째로 재시도하므로 길이 초과를 422로 거르면 이벤트 하나가 큐 전체를 막는다.
# VARCHAR 를 넘긴 값은 DB에서 500이 나 같은 일이 생긴다. 그래서 거르지 않고 자른다.
# content_excerpt(16000)·title(500)은 기존대로 api/events.py 에서 민감 URL 판정과 함께 자른다.
_MAX_URL_LEN = 32768  # DB는 Text. 크롬 주소창 표시 한도 수준으로, 실사용 URL은 잘리지 않는다.
_FIELD_WIDTHS = {
    "url": _MAX_URL_LEN,
    "referrer_url": _MAX_URL_LEN,
    "event_type": 20,  # DB VARCHAR(20)
    "source": 20,  # DB VARCHAR(20)
    "device_id": 64,  # DB VARCHAR(64)
    "previous_event_id": 36,  # DB VARCHAR(36)
}


def _cut(value: str | None, width: int) -> str | None:
    return value[:width] if isinstance(value, str) else value


class ExplorationEventIn(BaseModel):
    id: str
    url: str
    title: str | None = None
    visited_at: datetime
    ended_at: datetime | None = None
    active_duration_ms: int = 0
    tab_id: int | None = None
    window_id: int | None = None
    previous_event_id: str | None = None
    referrer_url: str | None = None
    event_type: str = "visit"
    content_excerpt: str = ""
    source: str = "browser"
    device_id: str | None = None
    # 팀 수집 표시(docs/team-collect-mode.md §2.2·§5). 클라이언트의 요청일 뿐이며 서버가 창·기기·멤버십·시각·
    # 민감/제외 판정을 통과할 때만 저장한다. 둘 다 있어야 판정한다. window_id(브라우저 창 번호)와 다른 값이다.
    # 36자(UUID)를 넘으면 422로 배치를 거르지 않고 표시만 버린다 — 이벤트는 개인 기록으로 받는다.
    workspace_id: str | None = None
    collect_window_id: str | None = None

    @field_validator("workspace_id", "collect_window_id")
    @classmethod
    def _drop_oversized_team_mark(cls, value: str | None) -> str | None:
        return None if isinstance(value, str) and len(value) > 36 else value

    @field_validator(*_FIELD_WIDTHS)
    @classmethod
    def _cut_to_width(cls, value: str | None, info) -> str | None:
        return _cut(value, _FIELD_WIDTHS[info.field_name])

    @field_validator("id")
    @classmethod
    def _validate_uuid_format(cls, value: str) -> str:
        try:
            uuid.UUID(value)
        except (ValueError, AttributeError, TypeError) as exc:
            raise ValueError("id must be a valid UUID string") from exc
        return value


class EventBatchRequest(BaseModel):
    device_id: str | None = None
    events: list[ExplorationEventIn] = Field(min_length=1, max_length=200)

    @field_validator("device_id")
    @classmethod
    def _cut_device_id(cls, value: str | None) -> str | None:
        return _cut(value, _FIELD_WIDTHS["device_id"])


# ── 응답 ──────────────────────────────────────────────


class EventIngestResult(BaseModel):
    accepted: int
    duplicates: int
    filtered: int
    pending_total: int
    # 팀 표시를 받아들인 수 / 팀 표시를 지우고 개인으로 저장한 수(이유는 알리지 않는다).
    team_accepted: int = 0
    team_downgraded: int = 0
    # 요청이 가리킨 수집 창 중 서버에서 이미 끝난 것이 있다 — 확장이 로컬 수집 상태를 끄는 유일한 신호(S'5).
    window_closed: bool = False


class PendingCountResponse(BaseModel):
    pending: int
    last_completed_sync_at: str | None = None


class EventListItem(BaseModel):
    """GET /events?date= 항목 (docs/api-design-v2.md §3).

    session_id/session_title은 아직 세션에 배정되지 않은 이벤트에서는 null.
    excluded=True면 노이즈 사전 필터/LLM이 세션 대상에서 제외한 스침 방문 —
    Timeline에는 "제외됨" 뱃지로 계속 노출된다(삭제 아님).
    """

    event_id: str
    url: str
    title: str | None = None
    domain: str | None = None
    visited_at: str
    active_duration_ms: int | None = None
    session_id: str | None = None
    session_title: str | None = None
    excluded: bool = False


class MemorySearchEventItem(BaseModel):
    """GET /search?scope=memory 의 events 항목.

    필드 구성은 M4 구현 계약을 따른다 — doc(§8)의 relevance_score/match_reason 대신
    active_duration_ms/session_title/matched_by를 노출한다(호출자 지시, 최종 보고에 근거 기록).
    """

    event_id: str
    url: str
    title: str | None = None
    domain: str | None = None
    visited_at: str
    active_duration_ms: int | None = None
    session_id: str | None = None
    session_title: str | None = None
    matched_by: Literal["session", "keyword"]


class MemorySearchResponse(BaseModel):
    sessions: list[SessionDetail]
    events: list[MemorySearchEventItem]
