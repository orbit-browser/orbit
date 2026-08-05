"""배치 세션화 오케스트레이션 — claim → dedup → grouping → intent → apply → refresh
(docs/target-architecture.md §1, §5, docs/api-design-v2.md §4·§5).

모듈 레벨 asyncio.Lock으로 배치 동시 실행을 막는다. run_batch()는 claim까지만
동기적으로 수행하고(빠름), 그룹별 임베딩/LLM/DB 반영은 asyncio.create_task로
백그라운드 실행해 POST /sync가 즉시 반환할 수 있게 한다. 락은 백그라운드 처리가
끝날 때까지 유지된다(배치 전체를 직렬화하는 것이 목적이므로).
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, update

from ..ai.embedding import embed
from ..config import settings
from ..db.models import ExplorationEvent, Session as SessionModel, SyncBatch, SyncBatchEvent
from ..db.session import AsyncSessionLocal
from ..db.vector import search_similar_with_scores
from ..services import intent_analyzer
from ..services.event_filter import is_system_url
from ..services.grouper import dedupe_events, group_by_time_gap
from ..services.session_updater import apply_assignments, refresh_session_ai

logger = logging.getLogger(__name__)

_GAP_MINUTES = 30
_MAX_GROUP_SIZE = 25
_CANDIDATE_VECTOR_LIMIT = 3
_CANDIDATE_RECENT_LIMIT = 5
_CANDIDATE_RECENT_HOURS = 24
# 벡터 유사 후보도 이 기간을 넘긴 세션이면 제외 — 주제가 비슷하다는 이유로
# 오래전 끝난 탐색에 조용히 append되는 것을 막는다(도그푸딩 1차 피드백).
_CANDIDATE_MAX_AGE_DAYS = 7
_ERROR_MESSAGE_MAX_CHARS = 500

_batch_lock = asyncio.Lock()
_background_tasks: set[asyncio.Task] = set()


class SyncBatchRunningError(Exception):
    """POST /sync 호출측이 409로 매핑할 수 있게 현재 실행 중인 batch_id를 함께 전달한다."""

    def __init__(self, batch_id: str | None):
        super().__init__("Sync batch already running")
        self.batch_id = batch_id


def is_running() -> bool:
    return _batch_lock.locked()


# ── 이벤트 dict 변환 ──────────────────────────────────────────────


def _event_to_dict(row: ExplorationEvent) -> dict:
    return {
        "id": row.id,
        "url": row.url,
        "normalized_url": row.normalized_url,
        "title": row.title,
        "domain": row.domain,
        "search_query": row.search_query,
        "visited_at": row.visited_at,
        "ended_at": row.ended_at,
        "active_duration_ms": row.active_duration_ms,
        "content_excerpt": row.content_excerpt,
        "content_hash": row.content_hash,
        "tab_id": row.tab_id,
        "window_id": row.window_id,
        "event_type": row.event_type,
    }


def _group_embedding_text(group: list[dict]) -> str:
    parts = [f"{e.get('title') or ''} {e.get('domain') or ''}".strip() for e in group]
    return " ".join(p for p in parts if p)


def _sessions_to_candidates(sessions: list[SessionModel]) -> list[dict]:
    now = datetime.now(timezone.utc)
    candidates = []
    for s in sessions:
        summary = s.summary or {}
        last_activity = s.last_activity_at or s.created_at
        candidates.append(
            {
                "session_id": s.id,
                "title": s.title,
                "overview": summary.get("overview") or "",
                "keywords": s.keywords or [],
                # LLM이 "이어지는 탐색"인지 판단할 때 참고할 경과일 — 프롬프트에 표기됨
                "last_activity_days_ago": max(0, (now - last_activity).days) if last_activity else None,
            }
        )
    return candidates


# ── DB 게이트웨이 함수 ──────────────────────────────────────────────


async def _get_running_batch_id() -> str | None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(SyncBatch.id)
            .where(SyncBatch.status == "running")
            .order_by(SyncBatch.started_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()


async def _create_batch_row(trigger_type: str) -> str:
    async with AsyncSessionLocal() as db:
        batch = SyncBatch(
            trigger_type=trigger_type,
            status="running",
            prompt_version=intent_analyzer.PROMPT_VERSION,
        )
        db.add(batch)
        await db.commit()
        await db.refresh(batch)
        return batch.id


async def _claim_pending_events(batch_id: str) -> list[dict]:
    """pending 이벤트를 claim(→processing)하고 sync_batch_events에 감사 로그를 남긴다."""
    async with AsyncSessionLocal() as db:
        subquery = (
            select(ExplorationEvent.id)
            .where(
                ExplorationEvent.sync_status == "pending",
                ExplorationEvent.user_id == "local",
            )
            .order_by(ExplorationEvent.visited_at)
            .limit(settings.sync_max_events_per_batch)
        )
        result = await db.execute(
            update(ExplorationEvent)
            .where(ExplorationEvent.id.in_(subquery))
            .values(sync_status="processing")
            .returning(ExplorationEvent)
        )
        rows = result.scalars().all()
        events = [_event_to_dict(r) for r in rows]

        if events:
            db.add_all(SyncBatchEvent(batch_id=batch_id, event_id=e["id"]) for e in events)

        await db.commit()
        return events


async def _set_status(event_ids: list[str], status: str) -> None:
    if not event_ids:
        return
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(ExplorationEvent).where(ExplorationEvent.id.in_(event_ids)).values(sync_status=status)
        )
        await db.commit()


async def _complete_batch(batch_id: str, event_count: int, model: str | None = None) -> None:
    async with AsyncSessionLocal() as db:
        batch = await db.get(SyncBatch, batch_id)
        if batch:
            batch.status = "completed"
            batch.completed_at = datetime.now(timezone.utc)
            batch.event_count = event_count
            if model:
                batch.model = model
            await db.commit()


async def _fail_batch(batch_id: str, exc: Exception) -> None:
    async with AsyncSessionLocal() as db:
        batch = await db.get(SyncBatch, batch_id)
        if batch:
            batch.status = "failed"
            batch.completed_at = datetime.now(timezone.utc)
            batch.error_message = str(exc)[:_ERROR_MESSAGE_MAX_CHARS]
            await db.commit()
        # 남은 processing 이벤트는 pending으로 복귀시켜 다음 배치가 재시도하게 한다.
        await db.execute(
            update(ExplorationEvent)
            .where(ExplorationEvent.sync_status == "processing")
            .values(sync_status="pending")
        )
        await db.commit()


async def _fetch_candidates(vector: list[float]) -> list[dict]:
    """벡터 유사 세션(top3) + 최근 24h 활성 이벤트 기반 세션(≤5)을 합쳐 후보를 만든다."""
    try:
        scored = await search_similar_with_scores(
            vector, limit=_CANDIDATE_VECTOR_LIMIT, score_threshold=settings.search_score_threshold
        )
        vector_ids = [session_id for session_id, _score in scored]
    except Exception as exc:
        logger.warning("후보 세션 벡터 검색 실패(%s) — 벡터 후보 없이 진행", exc)
        vector_ids = []

    async with AsyncSessionLocal() as db:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=_CANDIDATE_RECENT_HOURS)
        recent_result = await db.execute(
            select(SessionModel.id)
            .where(
                SessionModel.origin == "events",
                SessionModel.status == "active",
                SessionModel.last_activity_at.is_not(None),
                SessionModel.last_activity_at >= cutoff,
            )
            .order_by(SessionModel.last_activity_at.desc())
            .limit(_CANDIDATE_RECENT_LIMIT)
        )
        recent_ids = list(recent_result.scalars().all())

        combined_ids: list[str] = []
        seen: set[str] = set()
        for session_id in [*vector_ids, *recent_ids]:
            if session_id not in seen:
                seen.add(session_id)
                combined_ids.append(session_id)

        if not combined_ids:
            return []

        # recency 컷 — 벡터 후보에도 적용(최근 활동 후보는 24h 컷이라 항상 통과).
        # last_activity_at이 없는 snapshot 세션은 created_at 기준으로 판정한다.
        recency_floor = datetime.now(timezone.utc) - timedelta(days=_CANDIDATE_MAX_AGE_DAYS)
        sessions_result = await db.execute(
            select(SessionModel).where(
                SessionModel.id.in_(combined_ids),
                func.coalesce(SessionModel.last_activity_at, SessionModel.created_at)
                >= recency_floor,
            )
        )
        sessions_by_id = {s.id: s for s in sessions_result.scalars().all()}

    ordered_sessions = [sessions_by_id[sid] for sid in combined_ids if sid in sessions_by_id]
    return _sessions_to_candidates(ordered_sessions)


# ── 그룹/배치 처리 ──────────────────────────────────────────────


async def _process_group(group: list[dict], batch_id: str, touched: set[str]) -> str | None:
    """그룹 하나를 임베딩 → 후보 검색 → 의도 분석 → apply_assignments까지 처리한다.

    반환값은 이 그룹에서 실제 사용된 LLM model명(감사용, 없으면 None).
    """
    # event_filter 재검사(방어) — 인제스트 이후 상태가 바뀌었을 수 있는 시스템 URL을 다시 거른다.
    filtered_group = [e for e in group if not is_system_url(e["url"])]
    filtered_ids = {e["id"] for e in filtered_group}
    discarded_ids = [e["id"] for e in group if e["id"] not in filtered_ids]
    if discarded_ids:
        await _set_status(discarded_ids, "discarded")

    if not filtered_group:
        return None

    # 기존 세션(embedding-passage로 저장됨)을 검색하는 쿼리이므로 비대칭 임베딩 규칙에 따라
    # embedding-query(기본값)를 쓴다(api/search.py의 검색 쿼리 임베딩과 동일한 규칙).
    vector = await embed(_group_embedding_text(filtered_group))
    candidates = await _fetch_candidates(vector)

    assignments = await intent_analyzer.analyze(filtered_group, candidates)

    async with AsyncSessionLocal() as db:
        touched_ids = await apply_assignments(db, filtered_group, assignments, batch_id)
    touched.update(touched_ids)

    models_used = {a.model for a in assignments if a.model}
    return next(iter(models_used), None)


async def _process_batch(batch_id: str, claimed: list[dict]) -> None:
    try:
        kept, discarded_ids = dedupe_events(claimed)
        if discarded_ids:
            await _set_status(discarded_ids, "processed")

        groups = group_by_time_gap(kept, gap_minutes=_GAP_MINUTES, max_group_size=_MAX_GROUP_SIZE)

        touched: set[str] = set()
        batch_model: str | None = None

        for group in groups:
            try:
                model = await _process_group(group, batch_id, touched)
                batch_model = model or batch_model
            except Exception as exc:
                # 그룹 실패는 해당 그룹 이벤트만 pending 복귀 후 계속(배치 전체 중단 금지).
                logger.warning("배치 그룹 처리 실패(batch_id=%s) — 이벤트 pending 복귀: %s", batch_id, exc)
                await _set_status([e["id"] for e in group], "pending")

        for session_id in touched:
            try:
                await refresh_session_ai(session_id)
            except Exception as exc:
                logger.warning("세션 재요약 실패(session_id=%s): %s", session_id, exc)

        await _complete_batch(batch_id, event_count=len(claimed), model=batch_model)
    except Exception as exc:
        logger.error("배치 실행 실패(batch_id=%s): %s", batch_id, exc)
        await _fail_batch(batch_id, exc)


def _on_batch_task_done(task: asyncio.Task) -> None:
    _background_tasks.discard(task)
    if not task.cancelled() and (exc := task.exception()):
        logger.error("배치 백그라운드 작업에서 처리되지 않은 예외: %s", exc)
    _batch_lock.release()


async def run_batch(trigger_type: str) -> str | None:
    """동기화 배치 1회를 트리거한다.

    - 이미 실행 중이면 SyncBatchRunningError(현재 batch_id 포함)를 던진다(호출측 409 처리용).
    - pending 이벤트가 없으면 배치를 completed(event_count=0)로 기록하고 None을 반환한다.
    - 있으면 claim까지 동기적으로 마친 뒤 나머지 처리(그룹화/LLM/반영)는 백그라운드로
      넘기고 batch_id를 즉시 반환한다(POST /sync가 202로 바로 응답할 수 있도록).
    """
    if _batch_lock.locked():
        raise SyncBatchRunningError(await _get_running_batch_id())

    await _batch_lock.acquire()

    try:
        batch_id = await _create_batch_row(trigger_type)
    except Exception:
        _batch_lock.release()
        raise

    try:
        claimed = await _claim_pending_events(batch_id)
    except Exception as exc:
        await _fail_batch(batch_id, exc)
        _batch_lock.release()
        raise

    if not claimed:
        await _complete_batch(batch_id, event_count=0)
        _batch_lock.release()
        return None

    task = asyncio.create_task(_process_batch(batch_id, claimed))
    _background_tasks.add(task)
    task.add_done_callback(_on_batch_task_done)
    return batch_id


async def periodic_sync_loop() -> None:
    """sync_interval_minutes 간격으로 자동 배치를 실행한다(0이면 main.py가 태스크를 만들지 않음)."""
    interval_seconds = settings.sync_interval_minutes * 60
    while True:
        await asyncio.sleep(interval_seconds)
        if _batch_lock.locked():
            logger.info("주기 동기화 스킵 — 배치 실행 중")
            continue
        try:
            await run_batch("periodic")
        except SyncBatchRunningError:
            logger.info("주기 동기화 스킵 — 락 경쟁으로 실행 중인 배치 감지")
        except Exception as exc:
            logger.error("주기 동기화 실행 실패: %s", exc)
