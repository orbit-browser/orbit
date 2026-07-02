import httpx
from ..config import settings


async def embed(text: str, *, model: str | None = None) -> list[float]:
    """Upstage embedding 모델로 4096차원 벡터 생성.

    비대칭 임베딩: 검색 쿼리는 embedding-query, 저장할 문서(요약문)는
    embedding-passage를 써야 검색 품질이 더 좋다 (model 미지정 시 query 모델 기본값).
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{settings.upstage_base_url}/embeddings",
            headers={"Authorization": f"Bearer {settings.upstage_api_key}"},
            json={"model": model or settings.embedding_model, "input": text},
        )
        resp.raise_for_status()
        data = resp.json()
        return data["data"][0]["embedding"]
