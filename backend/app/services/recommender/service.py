"""추천 세션 조립 — 신호 수집 → 1차 점수 → LLM 리랭킹 → 캐시.

## 갱신 정책 (stale-while-revalidate)

새 탭은 하루에 수십 번 열린다. 열 때마다 LLM을 부르면 비용이 선형으로 늘고
화면도 매번 로딩을 기다린다. 반대로 완전히 고정하면 방금 탐색한 맥락이 반영되지 않는다.

그래서:

1. 결과를 사용자별로 DB에 캐시한다(TTL `recommendation_ttl_minutes`, 기본 30분).
2. 새 탭을 열면 **캐시를 즉시 반환**한다 — 화면은 항상 0ms에 뜬다.
3. 캐시가 오래됐으면 응답은 그대로 주고 **백그라운드에서 다시 계산**한다.
   다음에 새 탭을 열면 새 추천이 보인다.

화면에서 3개를 번갈아 보여주는 캐러셀은 이미 받은 결과를 돌리는 것이라
추가 호출이 없다. 결과적으로 LLM 호출은 사용자당 시간당 최대 2회로 묶인다.
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ...ai.embedding import embed
from ...config import settings
from ...db.models import (
    ExplorationEvent,
    RecommendationCache,
    Session as SessionModel,
    SessionEvent,
)
from ...db.session import AsyncSessionLocal
from ...db.vector import search_similar_with_scores
from .llm_rerank import RecommendationContext, rerank_recommendations
from .scoring import SessionSignals, pick_top_candidates

logger = logging.getLogger(__name__)

#: LLM에 넘길 후보 수 상한
_CANDIDATE_LIMIT = 15
#: 최종 추천 개수
_RESULT_COUNT = 3
#: 신호를 계산할 세션 상한 — 세션이 수백 개여도 최근 것 위주로만 본다
_SCAN_LIMIT = 120

#: 같은 사용자에 대해 재계산이 겹치지 않게 하는 락
_refresh_locks: dict[str, asyncio.Lock] = {}
_background_tasks: set[asyncio.Task] = set()


def _lock_for(user_id: str) -> asyncio.Lock:
    lock = _refresh_locks.get(user_id)
    if lock is None:
        lock = asyncio.Lock()
        _refresh_locks[user_id] = lock
    return lock


# ── 신호 수집 ──────────────────────────────────────────────


def _open_task_count(summary: dict | None) -> int:
    """요약에 남아 있는 미완료 항목 수.

    todos/next_actions 는 "아직 하지 않은 것"으로 저장되므로 개수를 그대로 센다.
    """
    if not isinstance(summary, dict):
        return 0
    total = 0
    for key in ("todos", "next_actions"):
        value = summary.get(key)
        if isinstance(value, list):
            total += len(value)
    return total


def _context_overlap(session: SessionModel, context: RecommendationContext) -> float:
    """현재 탭·검색어와 세션 키워드/제목이 겹치는 정도 (0~1).

    형태소 분석 없이 공백 토큰 교집합만 본다 — 1차 점수는 저렴해야 하고,
    정교한 판단은 뒤의 LLM이 맡는다.
    """
    haystack = " ".join(
        filter(None, [context.current_title, context.current_url, context.query])
    ).lower()
    if not haystack:
        return 0.0

    terms = {str(k).lower() for k in (session.keywords or []) if str(k).strip()}
    terms.update(part for part in session.title.lower().split() if len(part) > 1)
    if not terms:
        return 0.0

    hits = sum(1 for term in terms if term in haystack)
    return min(1.0, hits / min(len(terms), 5))


async def _collect_signals(
    db: AsyncSession, user_id: str, context: RecommendationContext
) -> list[SessionSignals]:
    """추천 대상 세션과 신호를 모은다. merged/archived 는 제외."""
    result = await db.execute(
        select(SessionModel)
        .where(
            SessionModel.user_id == user_id,
            SessionModel.status == "active",
        )
        .order_by(
            func.coalesce(SessionModel.last_activity_at, SessionModel.created_at).desc()
        )
        .limit(_SCAN_LIMIT)
    )
    sessions = list(result.scalars().all())
    if not sessions:
        return []

    visit_days = await _distinct_visit_days(db, [s.id for s in sessions])
    vector_scores = await _vector_scores(context)

    signals: list[SessionSignals] = []
    for session in sessions:
        summary = session.summary if isinstance(session.summary, dict) else {}
        signals.append(
            SessionSignals(
                session_id=session.id,
                title=session.title,
                overview=str(summary.get("overview") or ""),
                last_activity_at=session.last_activity_at or session.created_at,
                open_task_count=_open_task_count(summary),
                distinct_visit_days=visit_days.get(session.id, 1),
                vector_score=vector_scores.get(session.id),
                context_overlap=_context_overlap(session, context),
                is_active=session.summary_status == "pending" or session.origin == "events",
                keywords=[str(k) for k in (session.keywords or [])],
            )
        )
    return signals


async def _distinct_visit_days(db: AsyncSession, session_ids: list[str]) -> dict[str, int]:
    """세션별로 '서로 다른 날짜에 방문한 일수'를 센다 — revisit 신호."""
    if not session_ids:
        return {}
    result = await db.execute(
        select(
            SessionEvent.session_id,
            func.count(func.distinct(func.date(ExplorationEvent.visited_at))),
        )
        .join(ExplorationEvent, SessionEvent.event_id == ExplorationEvent.id)
        .where(SessionEvent.session_id.in_(session_ids))
        .group_by(SessionEvent.session_id)
    )
    return {session_id: max(1, count) for session_id, count in result.all()}


async def _vector_scores(context: RecommendationContext) -> dict[str, float]:
    """현재 컨텍스트를 임베딩해 유사 세션 점수를 얻는다.

    컨텍스트가 없거나 임베딩/검색이 실패하면 빈 dict — similarity 신호만 빠지고
    나머지 신호로 추천은 계속 나간다.
    """
    text = " ".join(
        filter(None, [context.query, context.current_title, context.current_url])
    ).strip()
    if not text:
        return {}

    try:
        vector = await embed(text)
        scored = await search_similar_with_scores(vector, limit=_CANDIDATE_LIMIT)
    except Exception as exc:
        logger.warning("[recommend] 컨텍스트 유사도 계산 실패(%s) — similarity 신호 없이 진행", exc)
        return {}
    return {session_id: score for session_id, score in scored}


# ── 계산 ──────────────────────────────────────────────


async def compute_recommendations(
    db: AsyncSession, user_id: str, context: RecommendationContext
) -> list[dict]:
    """1차 점수 → LLM 리랭킹까지 수행해 추천 3개를 만든다."""
    signals = await _collect_signals(db, user_id, context)
    if not signals:
        return []

    now = datetime.now(timezone.utc)
    candidates = pick_top_candidates(signals, now, limit=_CANDIDATE_LIMIT)
    picks = await rerank_recommendations(candidates, context, count=_RESULT_COUNT)

    return [
        {
            "session_id": pick.scored.session_id,
            "title": pick.scored.signals.title,
            "kind": pick.kind.value,
            "reason": pick.reason,
            "score": round(pick.scored.score, 4),
        }
        for pick in picks
    ]


# ── 캐시 ──────────────────────────────────────────────


def _ttl() -> timedelta:
    return timedelta(minutes=settings.recommendation_ttl_minutes)


async def _read_cache(db: AsyncSession, user_id: str) -> RecommendationCache | None:
    return await db.scalar(
        select(RecommendationCache).where(RecommendationCache.user_id == user_id)
    )


async def _write_cache(db: AsyncSession, user_id: str, items: list[dict]) -> None:
    now = datetime.now(timezone.utc)
    await db.execute(
        pg_insert(RecommendationCache)
        .values(user_id=user_id, items=items, computed_at=now)
        .on_conflict_do_update(
            index_elements=[RecommendationCache.user_id],
            set_={"items": items, "computed_at": now},
        )
    )
    await db.commit()


async def _refresh(user_id: str, context: RecommendationContext) -> None:
    """백그라운드 재계산. 같은 사용자에 대해 동시에 하나만 돈다."""
    lock = _lock_for(user_id)
    if lock.locked():
        return
    async with lock:
        try:
            async with AsyncSessionLocal() as db:
                items = await compute_recommendations(db, user_id, context)
                await _write_cache(db, user_id, items)
        except Exception as exc:
            # 재계산 실패는 사용자 요청을 막지 않는다 — 다음 기회에 다시 시도한다.
            logger.warning("[recommend] 백그라운드 재계산 실패: %s", exc)


def _schedule_refresh(user_id: str, context: RecommendationContext) -> None:
    task = asyncio.create_task(_refresh(user_id, context))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


async def get_recommendations(
    db: AsyncSession, user_id: str, context: RecommendationContext
) -> tuple[list[dict], datetime | None, bool]:
    """추천을 돌려준다. `(items, computed_at, is_stale)`.

    캐시가 있으면 즉시 반환하고, 오래됐으면 백그라운드 재계산을 예약한다.
    캐시가 아예 없으면(최초 요청) 그 자리에서 계산한다 — 빈 화면을 보여주지 않기 위해서다.
    """
    cached = await _read_cache(db, user_id)

    if cached is None:
        items = await compute_recommendations(db, user_id, context)
        await _write_cache(db, user_id, items)
        return items, datetime.now(timezone.utc), False

    is_stale = datetime.now(timezone.utc) - cached.computed_at >= _ttl()
    if is_stale:
        _schedule_refresh(user_id, context)

    return list(cached.items or []), cached.computed_at, is_stale


async def invalidate(user_id: str) -> None:
    """세션이 바뀌었을 때 캐시를 낡은 것으로 만든다(동기화 배치 완료 시점 등).

    삭제 대신 `computed_at` 을 과거로 미는 방식이라, 다음 요청은 옛 추천을 즉시 받고
    백그라운드에서 새로 계산된다 — 빈 화면을 거치지 않는다.
    """
    try:
        async with AsyncSessionLocal() as db:
            cached = await _read_cache(db, user_id)
            if cached is None:
                return
            cached.computed_at = datetime.now(timezone.utc) - _ttl()
            await db.commit()
    except Exception as exc:
        logger.warning("[recommend] 캐시 무효화 실패: %s", exc)
