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
    QueryRequest,
    SearchParams,
    VectorParams,
)

from ..config import settings

logger = logging.getLogger(__name__)

COLLECTION = "orbit_sessions"
VECTOR_DIM = 4096
# ef256: 60/60 at 100/1k/5k/10k; fastest passing 10k p50/p95 36.88/118.57 ms (benchmarks/exhibition-2026/recall-fix).
SEARCH_HNSW_EF = 256

_client: AsyncQdrantClient | None = None

# 팀 수집 스트림(docs/team-collect-mode.md §4.3). 개인 스트림 세션은 이 필드를 두지 않는다 — 기존 포인트는
# 필드가 없어 개인으로 판정되므로 백필이 필요 없다. 배치 후보의 recall 필터일 뿐, 경계는 SQL 조건이다.
STREAM_FIELD = "collect_workspace_id"
# 스트림 필터를 걸지 않는다(검색·Ask·병합 제안 등 배치 후보가 아닌 호출).
ANY_STREAM = object()


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
        for field in ("user_id", STREAM_FIELD):
            if field in (info.payload_schema or {}):
                continue
            try:
                await client.create_payload_index(
                    collection_name=COLLECTION,
                    field_name=field,
                    field_schema=PayloadSchemaType.KEYWORD,
                )
                logger.info("Qdrant payload index '%s' 생성", field)
            except Exception as exc:  # 다른 프로세스가 먼저 만든 인덱스는 정상
                if "already exists" not in str(exc).lower():
                    raise
    except Exception as exc:
        logger.warning("Qdrant 초기화 실패 (%s) — 벡터 검색 비활성화", exc)


def _user_filter(user_id: str, stream: object = ANY_STREAM) -> Filter:
    must: list = [FieldCondition(key="user_id", match=MatchValue(value=user_id))]
    if stream is None:
        must.append(IsEmptyCondition(is_empty=PayloadField(key=STREAM_FIELD)))
    elif stream is not ANY_STREAM:
        must.append(FieldCondition(key=STREAM_FIELD, match=MatchValue(value=stream)))
    return Filter(must=must)


async def set_stream_payload(session_ids: list[str], workspace_id: str | None) -> None:
    """세션 포인트의 스트림 필드를 맞춘다. 실패해도 SQL 후보 조건이 막으므로 경고만 남긴다."""
    if not session_ids:
        return
    try:
        client = get_qdrant()
        if workspace_id is None:
            await client.delete_payload(collection_name=COLLECTION, keys=[STREAM_FIELD], points=session_ids)
        else:
            await client.set_payload(
                collection_name=COLLECTION, payload={STREAM_FIELD: workspace_id}, points=session_ids
            )
    except Exception as exc:
        logger.warning("Qdrant stream payload update failed (%d points): %s", len(session_ids), exc)


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


def _scope_filter(user_id: str, session_ids: list[str] | None, stream: object = ANY_STREAM) -> Filter:
    """top-k를 읽을 수 있는 포인트로 좁힌다. session_ids 가 있으면 그 id만(팀 범위), 없으면 그 사용자 소유.

    팀 범위에 user 필터를 걸면 다른 멤버가 공유한 세션이 빠진다. recall용 필터이고,
    보안 경계는 호출측 SQL 조건이며 그대로 유지한다.
    """
    if session_ids is not None:
        # ponytail: 팀 공유 세션 id 목록을 매 쿼리에 싣는다. 팀 공유가 수천 건을 넘으면
        # payload 에 workspace_ids 배열을 두고 MatchAny 로 바꾼다.
        return Filter(must=[HasIdCondition(has_id=session_ids)])
    return _user_filter(user_id, stream)


async def get_vectors(session_ids: list[str]) -> dict[str, list[float]]:
    """여러 세션 벡터를 한 번에 조회한다. 포인트가 없는 세션은 빠지고, Qdrant 오류는 호출측에 그대로 올린다
    (get_vector처럼 None으로 삼키면 장애가 "벡터 없음"으로 보인다)."""
    if not session_ids:
        return {}
    records = await get_qdrant().retrieve(
        collection_name=COLLECTION, ids=list(session_ids), with_vectors=True
    )
    return {str(record.id): record.vector for record in records if isinstance(record.vector, list)}


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
        search_params=SearchParams(hnsw_ef=SEARCH_HNSW_EF),
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
    session_ids: list[str] | None = None,
    stream: object = ANY_STREAM,
) -> list[tuple[str, float]]:
    """유사 세션을 (session_id, score) 쌍으로 반환 (Auto Session 배치의 후보 세션 검색, Ask 후보).

    session_ids 는 search_similar 와 같다 — 팀 범위면 공유된 세션 id 로만 좁힌다.
    stream 은 배치 후보용 스트림 필터(None=개인 스트림, 팀 id=그 팀 수집 스트림).
    """
    if session_ids is not None and not session_ids:
        return []
    client = get_qdrant()
    threshold = settings.search_score_threshold if score_threshold is None else score_threshold
    result = await client.query_points(
        collection_name=COLLECTION,
        query=query_vector,
        query_filter=_scope_filter(user_id, session_ids, stream),
        search_params=SearchParams(hnsw_ef=SEARCH_HNSW_EF),
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


async def score_sessions(
    query_vector: list[float], session_ids: list[str], *, user_id: str, stream: object = ANY_STREAM
) -> dict[str, float]:
    """지정한 세션들만 임계값 없이 점수를 매긴다. 포인트가 없는 세션(임베딩 전)은 결과에서 빠진다."""
    if not session_ids:
        return {}
    client = get_qdrant()
    result = await client.query_points(
        collection_name=COLLECTION,
        query=query_vector,
        query_filter=Filter(
            must=[*_user_filter(user_id, stream).must, HasIdCondition(has_id=list(session_ids))]
        ),
        limit=len(session_ids),
    )
    return {str(p.id): p.score for p in result.points}


async def score_sessions_many(
    query_vectors: dict[str, list[float]], session_ids: list[str], *, user_id: str
) -> dict[str, dict[str, float]]:
    """질의 벡터 여러 개를 지정한 세션들에 한 번의 요청으로 점수 매긴다(질의마다 score_sessions와 같은 조건)."""
    if not query_vectors or not session_ids:
        return {key: {} for key in query_vectors}
    owned_ids = Filter(must=[*_user_filter(user_id).must, HasIdCondition(has_id=list(session_ids))])
    keys = list(query_vectors)
    responses = await get_qdrant().query_batch_points(
        collection_name=COLLECTION,
        requests=[
            QueryRequest(query=query_vectors[key], filter=owned_ids, limit=len(session_ids)) for key in keys
        ],
    )
    return {key: {str(p.id): p.score for p in response.points} for key, response in zip(keys, responses)}
