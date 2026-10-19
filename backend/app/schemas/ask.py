from pydantic import BaseModel, Field, field_validator

from .assistant import AssistantRetrievalIntent

# 후속 질문 해석에 쓰는 이전 답변 길이 상한. 클라이언트가 긴 답변을 그대로 보내도 거부하지 않고 자른다.
MAX_HISTORY_ANSWER_CHARS = 4000


class AskHistoryTurn(BaseModel):
    """후속 질문을 해석하기 위한 이전 질문·답변 한 턴. 서버는 저장하지 않는다."""

    query: str = Field(min_length=1, max_length=2000)
    answer: str = ""
    source_session_ids: list[str] = Field(default_factory=list, max_length=5)

    @field_validator("answer")
    @classmethod
    def truncate_answer(cls, value: str) -> str:
        return value.strip()[:MAX_HISTORY_ANSWER_CHARS]

    @field_validator("source_session_ids")
    @classmethod
    def drop_blank_ids(cls, value: list[str]) -> list[str]:
        return [session_id for session_id in value if session_id.strip()][:5]


class AskStreamRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    session_id: str | None = Field(default=None, min_length=1)
    rerank: bool = True
    intent: AssistantRetrievalIntent = "search_memory"
    # 최근 대화(오래된 순, 최대 3턴). 비어 있으면 기존과 같은 독립 단일턴이다.
    history: list[AskHistoryTurn] = Field(default_factory=list, max_length=3)

    @field_validator("query")
    @classmethod
    def strip_query(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("query must not be blank")
        return stripped
