from pathlib import Path

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
    embedding_model: str = "embedding-query"

    # 데이터스토어
    database_url: str = "postgresql+asyncpg://orbit:orbit@localhost:5432/orbit"
    qdrant_url: str = "http://localhost:6333"


settings = Settings()
