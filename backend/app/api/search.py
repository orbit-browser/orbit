import logging
from typing import Annotated, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..ai.embedding import embed
from ..ai.reranker import rerank as llm_rerank
from ..config import settings
from ..db.models import (
    ExplorationEvent,
    SESSION_DISPLAY_TITLE,
    Session as SessionModel,
    SessionEvent,
)
from ..db.session import get_db
from ..db.vector import search_similar, search_similar_with_scores
from ..schemas.event import MemorySearchEventItem, MemorySearchResponse
from ..schemas.session import SessionDetail
from ..services.workspaces import session_scope_clause
from .deps import current_user_id
from .sessions import _to_detail
from .workspaces import team_shared_ids

router = APIRouter(tags=["search"])
logger = logging.getLogger(__name__)

# scope=memory 이벤트 매칭 캡 (M4 구현 계약)
_SESSION_EVENTS_PER_SESSION_CAP = 3
_SESSION_EVENTS_OVERALL_CAP = 10
_KEYWORD_EVENTS_CAP = 10
# exclude_ids 제외 후에도 cap을 채울 여지를 두기 위한 조회 상한(무제한 스캔 방지)
_KEYWORD_QUERY_FETCH_CAP = 200


async def _search_sessions_by_vector(
    q: str,
    limit: int,
    rerank: bool,
    db: AsyncSession,
    user_id: str,
    shared_ids: list[str] | None = None,
    workspace_id: str | None = None,
    *,
    candidate_floor: float | None = None,
) -> list[SessionDetail]:
    """기존 세션 벡터 검색 경로 — scope 무관하게(sessions/memory 둘 다) 그대로 재사용.

    shared_ids 는 Qdrant 후보 필터, workspace_id 는 SQL 권한 범위다.
    candidate_floor를 주면 그 점수 이상의 세션을 vector_score와 함께 후보로 돌려준다. 관련성 판단
    (세션 점수 또는 본문 조각 점수)과 최종 선택은 Ask가 본문 근거로 한다(ask_service.prepare_ask_context).
    """
    if shared_ids is not None and not shared_ids:
        return []  # 공유된 세션이 없는 팀 — 임베딩을 부를 필요가 없다
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

    scores: dict[str, float] = {}
    try:
        if candidate_floor is None:
            session_ids = await search_similar(
                query_vector, limit=fetch_limit, user_id=user_id, session_ids=shared_ids
            )
        else:
            scored = await search_similar_with_scores(
                query_vector,
                user_id=user_id,
                limit=fetch_limit,
                score_threshold=candidate_floor,
                session_ids=shared_ids,
            )
            scores = dict(scored)
            session_ids = [session_id for session_id, _score in scored]
    except Exception:
        logger.exception("Qdrant 검색 실패")
        raise HTTPException(status_code=503, detail="Vector search service unavailable")

    if not session_ids:
        return []

    # Qdrant 범위 필터는 recall용이다. 보안 경계는 이 SQL 조건이므로 빼지 않는다.
    result = await db.execute(
        select(SessionModel).where(
            SessionModel.id.in_(session_ids),
            session_scope_clause(user_id, workspace_id),
        )
    )
    sessions_by_id = {s.id: s for s in result.scalars().all()}

    # Qdrant 유사도 순서(높은 순)를 유지
    # 팀 범위 결과에는 소유자 개인 정보(폴더·공유된 팀)를 싣지 않는다.
    readable_ids = [sid for sid in session_ids if sid in sessions_by_id]
    candidates = [
        _to_detail(sessions_by_id[sid], include_private=workspace_id is None) for sid in readable_ids
    ]
    for candidate, sid in zip(candidates, readable_ids):
        candidate.vector_score = scores.get(sid)

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


async def _fetch_session_relevance_events(
    db: AsyncSession,
    session_ids: list[str],
    user_id: str,
    workspace_id: str | None = None,
) -> list[dict]:
    if not session_ids:
        return []
    result = await db.execute(
        select(SessionEvent, ExplorationEvent, SESSION_DISPLAY_TITLE)
        .join(ExplorationEvent, SessionEvent.event_id == ExplorationEvent.id)
        .join(SessionModel, SessionEvent.session_id == SessionModel.id)
        .where(
            SessionEvent.session_id.in_(session_ids),
            session_scope_clause(user_id, workspace_id),
        )
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
    db: AsyncSession,
    q: str,
    exclude_ids: set[str],
    user_id: str,
    workspace_id: str | None = None,
) -> list[dict]:
    """title/search_query/domain ILIKE 직접 매칭 — 세션 미할당 이벤트까지 커버(§8).

    팀 범위(workspace_id)에서는 공유된 세션에 속한 이벤트만 본다. 팀원의 세션에 묶이지 않은
    방문이나 공유하지 않은 세션의 방문은 절대 섞지 않는다.
    """
    like = f"%{q}%"
    owner_clause = (
        session_scope_clause(user_id, workspace_id)
        if workspace_id is not None
        else ExplorationEvent.user_id == user_id
    )
    result = await db.execute(
        select(ExplorationEvent, SessionEvent.session_id, SESSION_DISPLAY_TITLE)
        .outerjoin(SessionEvent, SessionEvent.event_id == ExplorationEvent.id)
        .outerjoin(SessionModel, SessionEvent.session_id == SessionModel.id)
        .where(
            owner_clause,
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
    db: AsyncSession,
    q: str,
    sessions: list[SessionDetail],
    user_id: str,
    workspace_id: str | None = None,
) -> list[MemorySearchEventItem]:
    session_ids = [s.session_id for s in sessions]
    relevance_rows = await _fetch_session_relevance_events(db, session_ids, user_id, workspace_id)
    exclude_ids = {r["event_id"] for r in relevance_rows}
    keyword_rows = await _fetch_keyword_matched_events(db, q, exclude_ids, user_id, workspace_id)

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
    user_id: str = Depends(current_user_id),
    workspace_id: Annotated[
        str | None, Query(description="팀 워크스페이스 id. 주면 그 팀에 공유된 세션만 검색")
    ] = None,
) -> list[SessionDetail] | MemorySearchResponse:
    shared_ids = await team_shared_ids(db, user_id, workspace_id)
    sessions = await _search_sessions_by_vector(q, limit, rerank, db, user_id, shared_ids, workspace_id)

    if scope != "memory":
        return sessions

    try:
        events = await _search_memory_events(db, q.strip(), sessions, user_id, workspace_id)
    except Exception:
        # DB 조회만 실패한 경우 sessions는 그대로 반환 — 전체 실패로 위장하지 않는다(§12, CLAUDE.md §10).
        logger.exception("Memory 검색의 이벤트 조회 실패 (q=%s)", q)
        events = []

    return MemorySearchResponse(sessions=sessions, events=events)
