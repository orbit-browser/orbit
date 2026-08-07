"""GET /recommendations — 새 탭의 "추천 세션" 3개.

응답은 캐시에서 즉시 나가고, 오래됐으면 백그라운드에서 다시 계산된다
(`services/recommender/service.py` 의 갱신 정책 참고).
"""

import logging

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.session import get_db
from ..schemas.recommendation import RecommendationResponse
from ..services.recommender.llm_rerank import RecommendationContext
from ..services.recommender.service import get_recommendations
from .deps import current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/recommendations", tags=["recommendations"])


@router.get("", response_model=RecommendationResponse)
async def read_recommendations(
    current_title: str | None = Query(None, description="현재 활성 탭 제목"),
    current_url: str | None = Query(None, description="현재 활성 탭 URL"),
    q: str | None = Query(None, description="현재 검색어"),
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> RecommendationResponse:
    context = RecommendationContext(current_title=current_title, current_url=current_url, query=q)

    try:
        items, computed_at, is_stale = await get_recommendations(db, user_id, context)
    except Exception:
        # 추천은 부가 기능이다 — 실패해도 새 탭이 열리지 않게 만들지 않는다.
        # 다만 조용히 성공으로 위장하지 않고 빈 목록임을 명시한다.
        logger.exception("[recommend] 추천 생성 실패 (user=%s)", user_id)
        return RecommendationResponse(items=[], computed_at=None, is_stale=False)

    return RecommendationResponse(items=items, computed_at=computed_at, is_stale=is_stale)
