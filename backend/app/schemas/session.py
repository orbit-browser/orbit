from pydantic import BaseModel, Field


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
    saved_at: str  # ISO 8601


class PatchSessionRequest(BaseModel):
    title: str = Field(min_length=1)


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


class SaveSessionResponse(BaseModel):
    session_id: str
    title: str
    summary: SessionSummary
    created_at: str


class SessionListItem(BaseModel):
    session_id: str
    title: str
    overview: str
    tab_count: int
    created_at: str


class SessionDetail(BaseModel):
    session_id: str
    title: str
    summary: SessionSummary
    tabs: list[TabItemResponse]
    created_at: str
    updated_at: str
