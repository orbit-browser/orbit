"""세션 병합 실행/되돌리기 (merge P2·P3, docs/merge-design.md §4).

파괴적(가역) 연산이므로 항상 사용자 확인(엔드포인트 호출) 후에만 수행한다 — 자동 병합 금지.
병합은 단일 트랜잭션으로 DB 상태를 옮기고, 재요약/재임베딩(외부 LLM·별도 세션)은 호출측이
백그라운드로 분리한다(코드베이스 관행 — session_updater.apply_assignments와 동일 계층 분리).

디스패치/검증 로직은 게이트웨이 함수(`_fetch_events_ordered` 등)를 통해 DB에 접근하므로
기존 테스트 관행(fake DB + monkeypatch)으로 검증할 수 있다.
"""

import logging
from datetime import datetime, timezone

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db.models import ExplorationEvent, Session as SessionModel, SessionEvent
from .merge_suggester import _normalize_tokens, find_merge_suggestions

logger = logging.getLogger(__name__)


class MergeError(Exception):
    """병합/되돌리기 불가. code로 HTTP 상태를 매핑한다(not_found=404, invalid=400, conflict=409)."""

    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


# ── 순수 함수 ──────────────────────────────────────────────


def _union_keywords(a: list, b: list) -> list:
    """순서를 보존한 키워드 합집합(a 먼저, 중복 제거)."""
    seen: set = set()
    out: list = []
    for k in [*(a or []), *(b or [])]:
        if k not in seen:
            seen.add(k)
            out.append(k)
    return out


def _title_jaccard(a: str, b: str) -> float:
    """두 제목의 토큰 자카드 유사도(0~1). 자동 병합의 '거의 동일한 제목' 판정에 쓴다."""
    ta, tb = _normalize_tokens([a]), _normalize_tokens([b])
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def is_auto_merge_candidate(
    score: float,
    survivor_title: str,
    absorbed_title: str,
    *,
    floor: float,
    title_jaccard: float,
) -> bool:
    """자동 병합 대상인가 — '명백한 중복'만 통과(순수 함수).

    코사인 >= floor AND 제목 토큰 자카드 >= title_jaccard. 제안 floor보다 훨씬 엄격하게 잡아
    사람 확인 없이 합쳐도 안전한 near-duplicate만 허용한다.
    """
    return score >= floor and _title_jaccard(survivor_title, absorbed_title) >= title_jaccard


# ── DB 게이트웨이(단일 책임, 테스트에서 monkeypatch) ─────────────────


async def _fetch_events_ordered(
    db: AsyncSession, session_id: str, *, merged_from: str | None = None
) -> list[str]:
    """세션의 event_id 목록을 visited_at 오름차순으로 반환. merged_from 지정 시 그 태그 행만."""
    stmt = (
        select(SessionEvent.event_id)
        .join(ExplorationEvent, SessionEvent.event_id == ExplorationEvent.id)
        .where(SessionEvent.session_id == session_id)
        .order_by(ExplorationEvent.visited_at)
    )
    if merged_from is not None:
        stmt = stmt.where(SessionEvent.merged_from_session_id == merged_from)
    result = await db.execute(stmt)
    return [row[0] for row in result.all()]


async def _existing_event_ids(db: AsyncSession, session_id: str) -> set[str]:
    result = await db.execute(
        select(SessionEvent.event_id).where(SessionEvent.session_id == session_id)
    )
    return {row[0] for row in result.all()}


async def _next_sequence_order(db: AsyncSession, session_id: str) -> int:
    result = await db.execute(
        select(func.max(SessionEvent.sequence_order)).where(SessionEvent.session_id == session_id)
    )
    current_max = result.scalar_one_or_none()
    return 0 if current_max is None else current_max + 1


async def _move_event(
    db: AsyncSession,
    event_id: str,
    from_session: str,
    to_session: str,
    sequence_order: int,
    merged_from: str | None,
) -> None:
    """session_events 한 행을 from_session→to_session으로 이전(sequence_order·태그 재설정)."""
    await db.execute(
        update(SessionEvent)
        .where(
            SessionEvent.session_id == from_session,
            SessionEvent.event_id == event_id,
        )
        .values(
            session_id=to_session,
            sequence_order=sequence_order,
            merged_from_session_id=merged_from,
        )
    )


async def _delete_event(db: AsyncSession, session_id: str, event_id: str) -> None:
    await db.execute(
        delete(SessionEvent).where(
            SessionEvent.session_id == session_id,
            SessionEvent.event_id == event_id,
        )
    )


async def _recompute_session_stats(db: AsyncSession, session: SessionModel) -> None:
    """session_events 기준으로 event_count·total_active_duration_ms·started_at·last_activity_at 재계산."""
    row = (
        await db.execute(
            select(
                func.count(),
                func.coalesce(func.sum(ExplorationEvent.active_duration_ms), 0),
                func.min(ExplorationEvent.visited_at),
                func.max(ExplorationEvent.visited_at),
            )
            .select_from(SessionEvent)
            .join(ExplorationEvent, SessionEvent.event_id == ExplorationEvent.id)
            .where(SessionEvent.session_id == session.id)
        )
    ).one()
    count, duration, started, last = row
    session.event_count = count
    session.total_active_duration_ms = int(duration or 0)
    if count:
        session.started_at = started
        session.last_activity_at = last


# ── 오케스트레이터 ──────────────────────────────────────────────


async def merge_sessions(
    db: AsyncSession, survivor_id: str, absorbed_id: str
) -> SessionModel:
    """absorbed 세션을 survivor로 흡수한다(단일 트랜잭션). 갱신된 survivor를 반환.

    재요약/재임베딩과 absorbed의 Qdrant 포인트 삭제는 호출측이 백그라운드로 처리한다.
    """
    if survivor_id == absorbed_id:
        raise MergeError("invalid", "survivor and absorbed must differ")

    survivor = await db.get(SessionModel, survivor_id)
    absorbed = await db.get(SessionModel, absorbed_id)
    if survivor is None or absorbed is None:
        raise MergeError("not_found", "session not found")
    if survivor.status != "active" or absorbed.status != "active":
        raise MergeError("conflict", "both sessions must be active")

    absorbed_event_ids = await _fetch_events_ordered(db, absorbed_id)
    survivor_event_ids = await _existing_event_ids(db, survivor_id)
    next_seq = await _next_sequence_order(db, survivor_id)

    for event_id in absorbed_event_ids:
        if event_id in survivor_event_ids:
            # 이미 survivor에 있는 이벤트는 중복 — absorbed 쪽 행을 제거(dedup)
            await _delete_event(db, absorbed_id, event_id)
            continue
        await _move_event(db, event_id, absorbed_id, survivor_id, next_seq, absorbed_id)
        next_seq += 1

    await _recompute_session_stats(db, survivor)
    survivor.keywords = _union_keywords(survivor.keywords, absorbed.keywords)
    survivor.summary_status = "pending"  # 재요약 예약 신호
    survivor.updated_at = datetime.now(timezone.utc)

    absorbed.status = "merged"
    absorbed.merged_into = survivor_id
    absorbed.event_count = 0
    absorbed.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(survivor)
    return survivor


async def unmerge_sessions(
    db: AsyncSession, survivor_id: str, absorbed_id: str
) -> tuple[SessionModel, SessionModel]:
    """이전 병합을 되돌린다 — absorbed에서 온 이벤트를 원 세션으로 복원(단일 트랜잭션).

    재요약/재임베딩은 호출측이 백그라운드로 처리한다. (A, B) 갱신본을 반환.
    """
    survivor = await db.get(SessionModel, survivor_id)
    absorbed = await db.get(SessionModel, absorbed_id)
    if survivor is None or absorbed is None:
        raise MergeError("not_found", "session not found")
    if absorbed.status != "merged" or absorbed.merged_into != survivor_id:
        raise MergeError("invalid", "absorbed was not merged into survivor")

    restored_ids = await _fetch_events_ordered(db, survivor_id, merged_from=absorbed_id)
    if not restored_ids:
        raise MergeError("invalid", "no events to restore for this merge")

    seq = 0
    for event_id in restored_ids:
        await _move_event(db, event_id, survivor_id, absorbed_id, seq, None)
        seq += 1

    await _recompute_session_stats(db, survivor)
    await _recompute_session_stats(db, absorbed)

    absorbed.status = "active"
    absorbed.merged_into = None
    absorbed.summary_status = "pending"
    absorbed.updated_at = datetime.now(timezone.utc)
    survivor.summary_status = "pending"
    survivor.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(survivor)
    await db.refresh(absorbed)
    return survivor, absorbed


async def auto_merge_duplicates(db: AsyncSession) -> list[tuple[str, str]]:
    """opt-in 자동 병합 — '명백한 중복'만 병합하고 (survivor_id, absorbed_id) 목록을 반환한다.

    settings.auto_merge_enabled가 True일 때만 호출한다(호출측 가드). 제안(find_merge_suggestions)에서
    is_auto_merge_candidate를 통과한 쌍만 병합하며, 한 실행에서 이미 소비된 세션이 다시 등장하면 건너뛴다.
    재요약/재임베딩·흡수 세션 Qdrant 포인트 삭제는 호출측이 반환 목록으로 처리한다.
    """
    suggestions = await find_merge_suggestions(db)
    consumed: set[str] = set()
    merged: list[tuple[str, str]] = []
    for s in suggestions:
        if not is_auto_merge_candidate(
            s.score,
            s.survivor_title,
            s.absorbed_title,
            floor=settings.auto_merge_floor,
            title_jaccard=settings.auto_merge_title_jaccard,
        ):
            continue
        if s.survivor_id in consumed or s.absorbed_id in consumed:
            continue
        try:
            await merge_sessions(db, s.survivor_id, s.absorbed_id)
        except MergeError as exc:
            logger.warning("자동 병합 건너뜀(%s <- %s): %s", s.survivor_id, s.absorbed_id, exc)
            continue
        consumed.add(s.survivor_id)
        consumed.add(s.absorbed_id)
        merged.append((s.survivor_id, s.absorbed_id))
        logger.info(
            "자동 병합: %s <- %s (score=%.3f)", s.survivor_id, s.absorbed_id, s.score
        )
    return merged
