import logging

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import (
    Distance,
    FieldCondition,
    Filter,
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
        try:
            await client.create_payload_index(
                collection_name=COLLECTION,
                field_name="user_id",
                field_schema=PayloadSchemaType.KEYWORD,
            )
        except Exception as exc:  # 이미 존재하는 인덱스는 정상
            if "already exists" not in str(exc).lower():
                raise
    except Exception as exc:
        logger.warning("Qdrant 초기화 실패 (%s) — 벡터 검색 비활성화", exc)


def _user_filter(user_id: str) -> Filter:
    return Filter(must=[FieldCondition(key="user_id", match=MatchValue(value=user_id))])


async def backfill_user_ids(page_size: int = 256) -> None:
    """payload에 user_id가 없는 기존 포인트를 SQL의 세션 소유자로 채운다. 세션이 없는 고아 포인트는 삭제.

    멱등 — 이미 채워진 포인트는 스캔 대상이 아니다. 실패해도 기동을 막지 않는다.
    """
    # 순환 import 방지를 위해 함수 안에서 import
    from sqlalchemy import select

    from .models import Session as SessionModel
    from .session import AsyncSessionLocal

    try:
        client = get_qdrant()
        missing = Filter(must=[IsEmptyCondition(is_empty=PayloadField(key="user_id"))])
        updated = deleted = 0
        offset = None
        while True:
            records, offset = await client.scroll(
                collection_name=COLLECTION,
                scroll_filter=missing,
                limit=page_size,
                offset=offset,
                with_payload=False,
                with_vectors=False,
            )
            if records:
                ids = [str(r.id) for r in records]
                async with AsyncSessionLocal() as db:
                    rows = await db.execute(
                        select(SessionModel.id, SessionModel.user_id).where(SessionModel.id.in_(ids))
                    )
                    owners = {sid: uid for sid, uid in rows.all()}
                # 소유자별로 묶어 set_payload 호출 수를 줄인다(포인트마다 호출하면 기동이 느려진다).
                by_owner: dict[str, list[str]] = {}
                for sid in ids:
                    if sid in owners:
                        by_owner.setdefault(owners[sid], []).append(sid)
                for uid, owned_ids in by_owner.items():
                    await client.set_payload(
                        collection_name=COLLECTION,
                        payload={"user_id": uid},
                        points=owned_ids,
                    )
                    updated += len(owned_ids)
                orphans = [sid for sid in ids if sid not in owners]
                if orphans:
                    await client.delete(
                        collection_name=COLLECTION,
                        points_selector=PointIdsList(points=orphans),
                    )
                    deleted += len(orphans)
            if offset is None:
                break
        logger.info("Qdrant user_id 백필 완료: 갱신 %d건, 고아 삭제 %d건", updated, deleted)
    except Exception as exc:
        logger.warning("Qdrant user_id 백필 실패 (%s) — 건너뜀", exc)


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


async def search_similar(
    query_vector: list[float], *, user_id: str, limit: int = 5
) -> list[str]:
    client = get_qdrant()
    result = await client.query_points(
        collection_name=COLLECTION,
        query=query_vector,
        query_filter=_user_filter(user_id),
        limit=limit,
        score_threshold=settings.search_score_threshold,
    )
    return [str(p.id) for p in result.points]


async def search_similar_with_scores(
    query_vector: list[float],
    *,
    user_id: str,
    limit: int = 5,
    score_threshold: float | None = None,
) -> list[tuple[str, float]]:
    """유사 세션을 (session_id, score) 쌍으로 반환 (Auto Session 배치의 후보 세션 검색용)."""
    client = get_qdrant()
    threshold = settings.search_score_threshold if score_threshold is None else score_threshold
    result = await client.query_points(
        collection_name=COLLECTION,
        query=query_vector,
        query_filter=_user_filter(user_id),
        limit=limit,
        score_threshold=threshold,
    )
    return [(str(p.id), p.score) for p in result.points]
