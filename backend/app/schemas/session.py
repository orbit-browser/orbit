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


class MergeRequest(BaseModel):
    """병합/되돌리기 요청 — survivor는 경로, absorbed는 본문 (merge P2·P3)."""

    absorbed_id: str = Field(min_length=1)


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
    # Auto Session append 시 갱신되는 마지막 활동 시각 — 목록 정렬·표시 기준.
    # origin='snapshot' 세션에는 없어 null(클라이언트는 created_at fallback).
    last_activity_at: str | None = None
    # 사용자 폴더 소속. null=미정리(docs/api-design-v2.md §13).
    folder_id: str | None = None


class SessionEventItem(BaseModel):
    """Session Timeline 항목 (docs/api-design-v2.md §6)."""

    event_id: str
    url: str
    title: str | None = None
    domain: str | None = None
    visited_at: str
    active_duration_ms: int | None = None
    relevance_score: float | None = None
    sequence_order: int


class MergeSignal(BaseModel):
    """병합 제안 근거 신호 (docs/merge-design.md §3.2)."""

    vector_score: float
    keyword_overlap: list[str]


class MergeSuggestion(BaseModel):
    """세션 병합 후보 (merge P1, docs/merge-design.md §6). 읽기 전용 제안 — 실행은 P2."""

    survivor_id: str
    absorbed_id: str
    survivor_title: str
    absorbed_title: str
    score: float
    signals: MergeSignal


class SessionVersionItem(BaseModel):
    """세션 요약 이력 항목 (docs/api-design-v2.md §7).

    prompt_version은 내부 감사용이라 노출하지 않는다(§7). model은 doc 예시에는
    있으나 구현 계약 문구에는 빠져 있어 optional로 추가한다(superset 정책, §11).
    """

    version: int
    title: str | None = None
    overview: str | None = None
    purpose: str | None = None
    highlights: list[str] = []
    todos: list[str] = []
    next_actions: list[str] = []
    model: str | None = None
    created_at: str
