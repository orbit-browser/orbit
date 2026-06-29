import httpx
from ..config import settings


async def embed(text: str) -> list[float]:
    """Upstage embedding-query 모델로 4096차원 벡터 생성."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{settings.upstage_base_url}/embeddings",
            headers={"Authorization": f"Bearer {settings.upstage_api_key}"},
            json={"model": settings.embedding_model, "input": text},
        )
        resp.raise_for_status()
        data = resp.json()
        return data["data"][0]["embedding"]
