from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..ai.embedding import embed
from ..ai.reranker import rerank as llm_rerank
from ..db.models import Session as SessionModel
from ..db.session import get_db
from ..db.vector import search_similar
from ..schemas.session import SessionDetail
from .sessions import _to_detail

router = APIRouter(tags=["search"])


@router.get("/search", response_model=list[SessionDetail])
async def search_sessions(
    q: str = Query(..., min_length=1, description="자연어 검색어"),
    limit: int = Query(5, ge=1, le=20),
    rerank: bool = Query(False, description="LLM 기반 결과 재정렬"),
    db: AsyncSession = Depends(get_db),
) -> list[SessionDetail]:
    # 리랭킹 시 후보를 더 많이 가져와 선택지를 넓힌다
    fetch_limit = min(limit * 2, 20) if rerank else limit

    query_vector = await embed(q.strip())
    session_ids = await search_similar(query_vector, limit=fetch_limit)

    if not session_ids:
        return []

    result = await db.execute(
        select(SessionModel).where(SessionModel.id.in_(session_ids))
    )
    sessions_by_id = {s.id: s for s in result.scalars().all()}

    # Qdrant 유사도 순서(높은 순)를 유지
    candidates = [_to_detail(sessions_by_id[sid]) for sid in session_ids if sid in sessions_by_id]

    if rerank and candidates:
        candidates = await llm_rerank(q.strip(), candidates)

    return candidates[:limit]
