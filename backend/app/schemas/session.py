from typing import Literal

from pydantic import BaseModel, Field

SummaryStatus = Literal["pending", "done", "failed"]

# ── 요청 ──────────────────────────────────────────────


class TabItemRequest(BaseModel):
    url: str
    title: str
    text_content: str
    tab_id: str = ""          # Chrome tab ID (복원 시 React key 용)
    fav_icon_url: str | None = None
    excerpt: str | None = None
    site_name: str | None = None


class SaveSessionRequest(BaseModel):
    tabs: list[TabItemRequest] = Field(min_length=1)


class PatchSessionRequest(BaseModel):
    title: str = Field(min_length=1, max_length=100)


# ── 공통 ──────────────────────────────────────────────


class SessionSummary(BaseModel):
    overview: str
    purpose: str = ""
    highlights: list[str] = []
    todos: list[str] = []
    next_actions: list[str] = []


# ── 응답 ──────────────────────────────────────────────


class TabItemResponse(BaseModel):
    id: str
    title: str
    url: str
    fav_icon_url: str | None = None


class SessionDetail(BaseModel):
    session_id: str
    title: str
    summary: SessionSummary
    summary_status: SummaryStatus
    tabs: list[TabItemResponse]
    created_at: str
    updated_at: str
