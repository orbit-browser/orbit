from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# uvicorn 실행 위치에 무관하게 backend/.env 를 로드한다
_ENV_FILE = Path(__file__).parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(_ENV_FILE), extra="ignore")

    # A.X-K1 (SKT, primary LLM)
    axk1_api_key: str = ""
    axk1_base_url: str = "https://awf-gw.adot.ai"
    axk1_model: str = "A.X-K1"

    # Upstage (solar-pro3 fallback + embedding)
    upstage_api_key: str = ""
    upstage_base_url: str = "https://api.upstage.ai/v1"
    solar_model: str = "solar-pro3"
    solar_mini_model: str = "solar-mini"
    embedding_model: str = "embedding-query"       # 검색 쿼리 임베딩
    embedding_passage_model: str = "embedding-passage"  # 저장 문서(요약) 임베딩

    # 데이터스토어
    database_url: str = "postgresql+asyncpg://orbit:orbit@localhost:5432/orbit"
    qdrant_url: str = "http://localhost:6333"
    search_score_threshold: float = Field(default=0.35, ge=0.0, le=1.0)

    # Auto Session 동기화 (M3 sync_pipeline에서 사용 — docs/implementation-roadmap.md M1-1)
    sync_interval_minutes: int = Field(default=0, ge=0)  # 0 = 주기 동기화 off
    sync_event_threshold: int = Field(default=30, ge=1)  # 개수 트리거 기준
    sync_max_events_per_batch: int = Field(default=150, ge=1)  # 배치당 claim 상한


settings = Settings()
