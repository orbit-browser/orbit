from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class RecommendedSession(BaseModel):
    session_id: str
    title: str
    #: 추천 성격 — 화면에서 배지로 쓸 수 있다
    kind: Literal["continue", "related", "rediscover"]
    #: 왜 지금 이 세션인지 (한 문장)
    reason: str
    #: 1차 점수 (0~1). 디버깅·튜닝용
    score: float


class RecommendationResponse(BaseModel):
    items: list[RecommendedSession] = Field(default_factory=list)
    #: 이 추천이 계산된 시각. 캐시가 비어 있으면 None
    computed_at: datetime | None = None
    #: True면 응답은 캐시이고 새 계산이 백그라운드에서 돌고 있다
    is_stale: bool = False
