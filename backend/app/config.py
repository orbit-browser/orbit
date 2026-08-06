from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# uvicorn 실행 위치에 무관하게 backend/.env 를 로드한다
_ENV_FILE = Path(__file__).parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(_ENV_FILE), extra="ignore")

    # A.X-K1 (SKT) — 요약·의도분석·리랭킹·채팅 primary (DecisionLog 2026-08-05)
    axk1_api_key: str = ""
    axk1_base_url: str = "https://awf-gw.adot.ai"
    axk1_model: str = "A.X-K1"

    # LG EXAONE (FriendliAI serverless, OpenAI 호환) — 클러스터링 primary.
    # dedicated endpoint는 웜 상태에서도 ~60초/호출로 부적합해 serverless 채택(DecisionLog 2026-08-05).
    friendli_api_key: str = ""
    friendli_base_url: str = "https://api.friendli.ai/serverless/v1"
    exaone_model: str = "LGAI-EXAONE/K-EXAONE-236B-A23B"

    # Upstage — embedding 전용 (채팅 경로는 A.X-K1 ↔ EXAONE 상호 폴백으로 대체)
    upstage_api_key: str = ""
    upstage_base_url: str = "https://api.upstage.ai/v1"
    embedding_model: str = "embedding-query"       # 검색 쿼리 임베딩
    embedding_passage_model: str = "embedding-passage"  # 저장 문서(요약) 임베딩

    # 데이터스토어
    database_url: str = "postgresql+asyncpg://orbit:orbit@localhost:5432/orbit"
    qdrant_url: str = "http://localhost:6333"
    # 0.28 = 검색 골든셋 실측(eval/run_retrieval_eval.py, 2026-08-05) 기준
    # 음성 질의 최고점(0.265)과 정답 최저점(0.289) 사이의 분리 구간 중앙값
    search_score_threshold: float = Field(default=0.28, ge=0.0, le=1.0)

    # Auto Session 동기화 (M3 sync_pipeline에서 사용 — docs/implementation-roadmap.md M1-1)
    sync_interval_minutes: int = Field(default=0, ge=0)  # 0 = 주기 동기화 off
    sync_event_threshold: int = Field(default=30, ge=1)  # 개수 트리거 기준
    sync_max_events_per_batch: int = Field(default=150, ge=1)  # 배치당 claim 상한

    # 서브클러스터링/append 게이팅 (DecisionLog 2026-08-06 "그룹 간 과잉 append").
    # subcluster_threshold: 골든셋 임베딩 실측 결과 안전 밴드 [0.30, 0.32]의 중앙값 0.31.
    #   <0.30이면 이질 주제가 병합(under-split), >0.32면 단일 주제가 과분할.
    subcluster_threshold: float = Field(default=0.31, ge=0.0, le=1.0)  # 낮을수록 덜 쪼갬
    # append_score_floor/max_age_days: 라이브 Qdrant 점수 미측정 상태의 보수적 잠정값 —
    #   실데이터 재세션화로 튜닝 필요(검색 positive-floor 0.289보다 소폭 위).
    append_score_floor: float = Field(default=0.35, ge=0.0, le=1.0)  # 검색 0.28보다 높게
    append_max_age_days: int = Field(default=3, ge=0)  # 후보 recency 7일보다 타이트


settings = Settings()
