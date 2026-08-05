import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .session import SessionDetail

# ── 요청 ──────────────────────────────────────────────


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


# ── 응답 ──────────────────────────────────────────────


class EventIngestResult(BaseModel):
    accepted: int
    duplicates: int
    filtered: int
    pending_total: int


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
