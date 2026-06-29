import logging

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import Distance, PointIdsList, PointStruct, VectorParams

from ..config import settings

logger = logging.getLogger(__name__)

COLLECTION = "orbit_sessions"
VECTOR_DIM = 4096

_client: AsyncQdrantClient | None = None


def get_qdrant() -> AsyncQdrantClient:
    global _client
    if _client is None:
        _client = AsyncQdrantClient(url=settings.qdrant_url)
    return _client


async def init_collection() -> None:
    """Qdrant 컬렉션이 없으면 생성. 연결 실패 시 경고만 남기고 계속 실행."""
    try:
        client = get_qdrant()
        existing = {c.name for c in (await client.get_collections()).collections}
        if COLLECTION not in existing:
            await client.create_collection(
                collection_name=COLLECTION,
                vectors_config=VectorParams(size=VECTOR_DIM, distance=Distance.COSINE),
            )
            logger.info("Qdrant 컬렉션 '%s' 생성", COLLECTION)
        else:
            logger.info("Qdrant 컬렉션 '%s' 확인 완료", COLLECTION)
    except Exception as exc:
        logger.warning("Qdrant 초기화 실패 (%s) — 벡터 검색 비활성화", exc)


async def upsert_point(session_id: str, vector: list[float], payload: dict) -> None:
    client = get_qdrant()
    await client.upsert(
        collection_name=COLLECTION,
        points=[PointStruct(id=session_id, vector=vector, payload=payload)],
    )


async def delete_point(session_id: str) -> None:
    try:
        client = get_qdrant()
        await client.delete(
            collection_name=COLLECTION,
            points_selector=PointIdsList(points=[session_id]),
        )
    except Exception as exc:
        logger.warning("Qdrant 포인트 삭제 실패 (session_id=%s): %s", session_id, exc)


async def search_similar(query_vector: list[float], limit: int = 5) -> list[str]:
    client = get_qdrant()
    result = await client.query_points(
        collection_name=COLLECTION,
        query=query_vector,
        limit=limit,
    )
    return [str(p.id) for p in result.points]
