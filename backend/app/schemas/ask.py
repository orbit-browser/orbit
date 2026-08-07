from pydantic import BaseModel, Field, field_validator

from .assistant import AssistantRetrievalIntent


class AskStreamRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    session_id: str | None = Field(default=None, min_length=1)
    rerank: bool = True
    intent: AssistantRetrievalIntent = "search_memory"

    @field_validator("query")
    @classmethod
    def strip_query(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("query must not be blank")
        return stripped
