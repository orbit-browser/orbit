import logging

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import (
    Distance,
    FieldCondition,
    Filter,
    HasIdCondition,
    IsEmptyCondition,
    MatchValue,
    PayloadField,
    PayloadSchemaType,
    PointIdsList,
    PointStruct,
    VectorParams,
)

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
        info = await client.get_collection(COLLECTION)
        if "user_id" not in (info.payload_schema or {}):
            await client.create_payload_index(
                collection_name=COLLECTION,
                field_name="user_id",
                field_schema=PayloadSchemaType.KEYWORD,
            )
            logger.info("Qdrant payload index 'user_id' 생성")
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


async def get_vector(session_id: str) -> list[float] | None:
    """Qdrant에 저장된 세션 임베딩 벡터를 조회. 포인트가 없거나 조회 실패 시 None (merge P1)."""
    try:
        client = get_qdrant()
        records = await client.retrieve(
            collection_name=COLLECTION,
            ids=[session_id],
            with_vectors=True,
        )
    except Exception as exc:
        logger.warning("Qdrant 벡터 조회 실패 (session_id=%s): %s", session_id, exc)
        return None
    if not records:
        return None
    vector = records[0].vector
    # 단일 무명 벡터만 사용 — named vector(dict) 형태는 이 컬렉션에서 발생하지 않음
    return vector if isinstance(vector, list) else None


def _scope_filter(user_id: str, session_ids: list[str] | None) -> Filter:
    """top-k를 읽을 수 있는 포인트로 좁힌다. session_ids 가 있으면 그 id만(팀 범위), 없으면 그 사용자 소유.

    recall용 필터다 — 보안 경계는 호출측 SQL 조건이며 그대로 유지한다.
    """
    if session_ids is not None:
        # ponytail: 팀 공유 세션 id 목록을 매 쿼리에 싣는다. 팀 공유가 수천 건을 넘으면
        # payload 에 workspace_ids 배열을 두고 MatchAny 로 바꾼다.
        return Filter(must=[HasIdCondition(has_id=session_ids)])
    return Filter(must=[FieldCondition(key="user_id", match=MatchValue(value=user_id))])


async def search_similar(
    query_vector: list[float],
    limit: int = 5,
    *,
    user_id: str,
    session_ids: list[str] | None = None,
) -> list[str]:
    if session_ids is not None and not session_ids:
        return []  # 공유된 세션이 없는 팀 — 빈 id 목록 필터를 Qdrant 에 보내지 않는다
    client = get_qdrant()
    result = await client.query_points(
        collection_name=COLLECTION,
        query=query_vector,
        query_filter=_scope_filter(user_id, session_ids),
        limit=limit,
        score_threshold=settings.search_score_threshold,
    )
    return [str(p.id) for p in result.points]


async def search_similar_with_scores(
    query_vector: list[float],
    limit: int = 5,
    score_threshold: float | None = None,
    *,
    user_id: str,
) -> list[tuple[str, float]]:
    """유사 세션을 (session_id, score) 쌍으로 반환 (Auto Session 배치의 후보 세션 검색용)."""
    client = get_qdrant()
    threshold = settings.search_score_threshold if score_threshold is None else score_threshold
    result = await client.query_points(
        collection_name=COLLECTION,
        query=query_vector,
        query_filter=_scope_filter(user_id, None),
        limit=limit,
        score_threshold=threshold,
    )
    return [(str(p.id), p.score) for p in result.points]


async def point_ids_missing_owner() -> list[str]:
    """`user_id` payload가 없는 포인트 id 목록 (소유자 payload 도입 이전 포인트의 backfill용)."""
    client = get_qdrant()
    missing = Filter(must=[IsEmptyCondition(is_empty=PayloadField(key="user_id"))])
    ids: list[str] = []
    offset = None
    while True:
        records, offset = await client.scroll(
            collection_name=COLLECTION,
            scroll_filter=missing,
            limit=256,
            offset=offset,
            with_payload=False,
            with_vectors=False,
        )
        ids.extend(str(record.id) for record in records)
        if offset is None:
            return ids


async def set_owner(user_id: str, session_ids: list[str]) -> None:
    await get_qdrant().set_payload(
        collection_name=COLLECTION,
        payload={"user_id": user_id},
        points=session_ids,
    )
