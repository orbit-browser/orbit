from typing import Literal

from pydantic import BaseModel, Field, field_validator


class OpenTabCandidate(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    title: str = Field(default="", max_length=500)
    url: str = Field(default="", max_length=4096)
    active: bool = False

    @field_validator("id", "title", "url")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()


class TabActionResolveRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    candidates: list[OpenTabCandidate] = Field(min_length=1, max_length=100)

    @field_validator("query")
    @classmethod
    def strip_query(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("query must not be blank")
        return stripped


class TabActionCandidateMatch(BaseModel):
    tab_id: str
    score: float


class TabActionResolveResponse(BaseModel):
    action: Literal["navigate_tab", "ask"]
    reason: Literal["matched", "non_navigation", "low_confidence"]
    tab_id: str | None = None
    score: float | None = None
    margin: float | None = None
    candidates: list[TabActionCandidateMatch] = Field(default_factory=list, max_length=3)
