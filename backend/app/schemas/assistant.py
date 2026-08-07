from typing import Literal, TypeAlias

from pydantic import BaseModel, Field, field_validator


AssistantIntent: TypeAlias = Literal[
    "navigate_tab",
    "find_sessions",
    "search_memory",
    "search_session",
]
AssistantRetrievalIntent: TypeAlias = Literal[
    "find_sessions",
    "search_memory",
    "search_session",
]
AssistantRouteReason: TypeAlias = Literal["rule", "semantic", "fallback"]


class AssistantRouteRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    session_id: str | None = Field(default=None, min_length=1, max_length=64)

    @field_validator("query")
    @classmethod
    def strip_query(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("query must not be blank")
        return stripped


class AssistantRouteResponse(BaseModel):
    intent: AssistantIntent
    confidence: float | None = None
    margin: float | None = None
    reason: AssistantRouteReason
