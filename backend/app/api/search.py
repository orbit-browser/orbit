import logging
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..ai.embedding import embed
from ..ai.reranker import rerank as llm_rerank
from ..db.models import ExplorationEvent, Session as SessionModel, SessionEvent
from ..db.session import get_db
from ..db.vector import search_similar
from ..schemas.event import MemorySearchEventItem, MemorySearchResponse
from ..schemas.session import SessionDetail
from .sessions import _to_detail

router = APIRouter(tags=["search"])
logger = logging.getLogger(__name__)

# scope=memory 이벤트 매칭 캡 (M4 구현 계약)
_SESSION_EVENTS_PER_SESSION_CAP = 3
_SESSION_EVENTS_OVERALL_CAP = 10
_KEYWORD_EVENTS_CAP = 10
# exclude_ids 제외 후에도 cap을 채울 여지를 두기 위한 조회 상한(무제한 스캔 방지)
_KEYWORD_QUERY_FETCH_CAP = 200


async def _search_sessions_by_vector(
    q: str, limit: int, rerank: bool, db: AsyncSession
) -> list[SessionDetail]:
    """기존 세션 벡터 검색 경로 — scope 무관하게(sessions/memory 둘 다) 그대로 재사용."""
    # 리랭킹 시 후보를 더 많이 가져와 선택지를 넓힌다
    fetch_limit = min(limit * 2, 20) if rerank else limit

    try:
        query_vector = await embed(q.strip())
    except httpx.TimeoutException:
        logger.warning("검색 임베딩 서비스 timeout")
        raise HTTPException(status_code=504, detail="Embedding service timed out")
    except httpx.HTTPStatusError as exc:
        logger.warning("검색 임베딩 upstream 오류 (status=%s)", exc.response.status_code)
        raise HTTPException(status_code=502, detail="Embedding service returned an error")
    except httpx.RequestError:
        logger.warning("검색 임베딩 서비스 연결 실패")
        raise HTTPException(status_code=503, detail="Embedding service unavailable")
    except (KeyError, IndexError, TypeError, ValueError):
        logger.error("검색 임베딩 응답 형식 오류")
        raise HTTPException(status_code=502, detail="Embedding service returned an invalid response")

    try:
        session_ids = await search_similar(query_vector, limit=fetch_limit)
    except Exception:
        logger.exception("Qdrant 검색 실패")
        raise HTTPException(status_code=503, detail="Vector search service unavailable")

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


# ── scope=memory: events 조합 (docs/api-design-v2.md §8) ──────────────────


def _score_session_event(relevance_score: float | None, active_duration_ms: int | None) -> float:
    relevance = relevance_score if relevance_score is not None else 0.0
    duration = active_duration_ms if active_duration_ms is not None else 1
    return relevance * duration


def _select_session_relevance_events(rows: list[dict]) -> list[dict]:
    """세션당 3개·전체 10개 캡으로 상위 이벤트를 고른다(순수 함수, DB 없음)."""
    by_session: dict[str, list[dict]] = {}
    for row in rows:
        by_session.setdefault(row["session_id"], []).append(row)

    top: list[dict] = []
    for items in by_session.values():
        items.sort(key=lambda r: r["_score"], reverse=True)
        top.extend(items[:_SESSION_EVENTS_PER_SESSION_CAP])

    top.sort(key=lambda r: r["_score"], reverse=True)
    return top[:_SESSION_EVENTS_OVERALL_CAP]


async def _fetch_session_relevance_events(db: AsyncSession, session_ids: list[str]) -> list[dict]:
    if not session_ids:
        return []
    result = await db.execute(
        select(SessionEvent, ExplorationEvent, SessionModel.title)
        .join(ExplorationEvent, SessionEvent.event_id == ExplorationEvent.id)
        .join(SessionModel, SessionEvent.session_id == SessionModel.id)
        .where(SessionEvent.session_id.in_(session_ids))
    )
    rows = [
        {
            "event_id": event.id,
            "url": event.url,
            "title": event.title,
            "domain": event.domain,
            "visited_at": event.visited_at,
            "active_duration_ms": event.active_duration_ms,
            "session_id": session_event.session_id,
            "session_title": session_title,
            "_score": _score_session_event(session_event.relevance_score, event.active_duration_ms),
        }
        for session_event, event, session_title in result.all()
    ]
    return _select_session_relevance_events(rows)


async def _fetch_keyword_matched_events(
    db: AsyncSession, q: str, exclude_ids: set[str]
) -> list[dict]:
    """title/search_query/domain ILIKE 직접 매칭 — 세션 미할당 이벤트까지 커버(§8)."""
    like = f"%{q}%"
    result = await db.execute(
        select(ExplorationEvent, SessionEvent.session_id, SessionModel.title)
        .outerjoin(SessionEvent, SessionEvent.event_id == ExplorationEvent.id)
        .outerjoin(SessionModel, SessionEvent.session_id == SessionModel.id)
        .where(
            ExplorationEvent.user_id == "local",
            ExplorationEvent.sync_status != "discarded",
            or_(
                ExplorationEvent.title.ilike(like),
                ExplorationEvent.search_query.ilike(like),
                ExplorationEvent.domain.ilike(like),
            ),
        )
        .order_by(ExplorationEvent.visited_at.desc())
        .limit(_KEYWORD_QUERY_FETCH_CAP)
    )

    items: list[dict] = []
    seen: set[str] = set()
    for event, session_id, session_title in result.all():
        if event.id in exclude_ids or event.id in seen:
            continue
        seen.add(event.id)
        items.append(
            {
                "event_id": event.id,
                "url": event.url,
                "title": event.title,
                "domain": event.domain,
                "visited_at": event.visited_at,
                "active_duration_ms": event.active_duration_ms,
                "session_id": session_id,
                "session_title": session_title,
            }
        )
        if len(items) >= _KEYWORD_EVENTS_CAP:
            break
    return items


async def _search_memory_events(
    db: AsyncSession, q: str, sessions: list[SessionDetail]
) -> list[MemorySearchEventItem]:
    session_ids = [s.session_id for s in sessions]
    relevance_rows = await _fetch_session_relevance_events(db, session_ids)
    exclude_ids = {r["event_id"] for r in relevance_rows}
    keyword_rows = await _fetch_keyword_matched_events(db, q, exclude_ids)

    def _to_item(row: dict, matched_by: Literal["session", "keyword"]) -> MemorySearchEventItem:
        return MemorySearchEventItem(
            event_id=row["event_id"],
            url=row["url"],
            title=row["title"],
            domain=row["domain"],
            visited_at=row["visited_at"].isoformat(),
            active_duration_ms=row["active_duration_ms"],
            session_id=row["session_id"],
            session_title=row["session_title"],
            matched_by=matched_by,
        )

    return [_to_item(r, "session") for r in relevance_rows] + [
        _to_item(r, "keyword") for r in keyword_rows
    ]


@router.get("/search", response_model=list[SessionDetail] | MemorySearchResponse)
async def search_sessions(
    q: str = Query(..., min_length=1, description="자연어 검색어"),
    limit: int = Query(5, ge=1, le=20),
    rerank: bool = Query(False, description="LLM 기반 결과 재정렬"),
    scope: Literal["sessions", "memory"] = Query("sessions", description="검색 범위(sessions|memory)"),
    db: AsyncSession = Depends(get_db),
) -> list[SessionDetail] | MemorySearchResponse:
    sessions = await _search_sessions_by_vector(q, limit, rerank, db)

    if scope != "memory":
        return sessions

    try:
        events = await _search_memory_events(db, q.strip(), sessions)
    except Exception:
        # DB 조회만 실패한 경우 sessions는 그대로 반환 — 전체 실패로 위장하지 않는다(§12, CLAUDE.md §10).
        logger.exception("Memory 검색의 이벤트 조회 실패 (q=%s)", q)
        events = []

    return MemorySearchResponse(sessions=sessions, events=events)
