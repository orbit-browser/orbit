import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

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
