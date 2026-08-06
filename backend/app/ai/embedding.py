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


async def embed_many(texts: list[str], *, model: str | None = None) -> list[list[float]]:
    """여러 텍스트를 한 번의 요청으로 임베딩한다(Upstage 배열 입력, OpenAI 호환).

    서브클러스터링처럼 그룹 내 이벤트별 임베딩이 여럿 필요할 때 HTTP 왕복을 1회로 줄인다.
    입력 순서와 반환 순서를 보장한다(Upstage가 index를 섞어 보낼 경우 대비해 정렬). 빈 입력은 [].
    """
    if not texts:
        return []
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{settings.upstage_base_url}/embeddings",
            headers={"Authorization": f"Bearer {settings.upstage_api_key}"},
            json={"model": model or settings.embedding_model, "input": texts},
        )
        resp.raise_for_status()
        data = resp.json()
        items = sorted(data["data"], key=lambda item: item["index"])
        return [item["embedding"] for item in items]
