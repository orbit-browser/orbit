from typing import Literal

from pydantic import BaseModel

TriggerType = Literal["manual", "periodic", "event_count", "idle"]

# ── 요청 ──────────────────────────────────────────────


class SyncTriggerRequest(BaseModel):
    trigger_type: TriggerType = "manual"


# ── 응답 ──────────────────────────────────────────────


class CurrentBatchInfo(BaseModel):
    batch_id: str
    trigger_type: str
    started_at: str
    event_count: int | None = None


class LastBatchInfo(BaseModel):
    batch_id: str
    status: str
    completed_at: str | None = None
    event_count: int | None = None


class SyncStatusResponse(BaseModel):
    running: bool
    current_batch: CurrentBatchInfo | None = None
    pending: int
    last_batch: LastBatchInfo | None = None


class SyncBatchSummary(BaseModel):
    batch_id: str
    trigger_type: str
    status: str
    started_at: str
    completed_at: str | None = None
    event_count: int | None = None
    model: str | None = None
    error_message: str | None = None


class SyncBatchDetail(SyncBatchSummary):
    prompt_version: str | None = None
