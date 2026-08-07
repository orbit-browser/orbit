"""배치 세션화 오케스트레이션 — claim → dedup → grouping → intent → apply → refresh
(docs/target-architecture.md §1, §5, docs/api-design-v2.md §4·§5).

모듈 레벨 asyncio.Lock으로 배치 동시 실행을 막는다. run_batch()는 claim까지만
동기적으로 수행하고(빠름), 그룹별 임베딩/LLM/DB 반영은 asyncio.create_task로
백그라운드 실행해 POST /sync가 즉시 반환할 수 있게 한다. 락은 백그라운드 처리가
끝날 때까지 유지된다(배치 전체를 직렬화하는 것이 목적이므로).
"""

import asyncio
import logging
from dataclasses import replace
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, update

from ..ai.embedding import embed_many
from ..config import settings
from ..db.models import ExplorationEvent, Session as SessionModel, SyncBatch, SyncBatchEvent
from ..db.session import AsyncSessionLocal
from ..db.vector import delete_point, search_similar_with_scores
from ..services import intent_analyzer
from ..services.event_filter import is_system_url
from ..services.intent_analyzer import Assignment
from ..services.noise_filter import split_noise
from ..services.grouper import dedupe_events, group_by_time_gap
from ..services.app_settings import is_auto_merge_enabled
from ..services.merge_service import auto_merge_duplicates
from ..services.session_updater import apply_assignments, refresh_session_ai
from ..services.subclusterer import subcluster

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
        # 세션 소유자는 이 값에서 파생된다(session_updater) — 별도로 넘기지 않는다
        "user_id": row.user_id,
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


def _event_embedding_text(event: dict) -> str:
    """서브클러스터링용 이벤트 텍스트 — 제목 + 도메인 + 검색어(있으면)."""
    parts = [event.get("title") or "", event.get("domain") or "", event.get("search_query") or ""]
    return " ".join(p for p in (s.strip() for s in parts) if p)


def _centroid(vectors: list[list[float]]) -> list[float]:
    """클러스터 후보검색용 대표 벡터(성분별 평균). Qdrant가 코사인 정규화하므로 방향만 유지하면 된다."""
    count = len(vectors)
    dim = len(vectors[0])
    return [sum(v[i] for v in vectors) / count for i in range(dim)]


def _sessions_to_candidates(
    sessions: list[SessionModel], scores_by_id: dict[str, float] | None = None
) -> list[dict]:
    now = datetime.now(timezone.utc)
    scores = scores_by_id or {}
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
                # 벡터 매치 점수(append 게이팅용). 최근-only 후보는 매치가 아니므로 None.
                "score": scores.get(s.id),
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


async def _claim_pending_events(batch_id: str) -> tuple[list[dict], str | None]:
    """pending 이벤트를 claim(→processing)하고 sync_batch_events에 감사 로그를 남긴다.

    **한 배치는 한 사용자의 이벤트만 다룬다.** 시간 gap 그룹화가 사용자 경계를 모르기 때문에
    여러 사용자 이벤트를 섞어 claim하면 서로 다른 사람의 방문이 한 세션으로 묶인다.
    가장 오래 기다린 pending 이벤트의 주인을 골라 그 사용자 것만 가져온다.
    나머지 사용자는 다음 배치에서 처리된다(주기 루프가 반복 호출).
    """
    async with AsyncSessionLocal() as db:
        target_user = await db.scalar(
            select(ExplorationEvent.user_id)
            .where(ExplorationEvent.sync_status == "pending")
            .order_by(ExplorationEvent.visited_at)
            .limit(1)
        )
        if target_user is None:
            return [], None

        subquery = (
            select(ExplorationEvent.id)
            .where(
                ExplorationEvent.sync_status == "pending",
                ExplorationEvent.user_id == target_user,
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
        return events, target_user


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


async def _fetch_candidates(vector: list[float], user_id: str) -> list[dict]:
    """벡터 유사 세션(top3) + 최근 24h 활성 이벤트 기반 세션(≤5)을 합쳐 후보를 만든다.

    후보는 **같은 사용자의 세션으로만** 제한한다. 이 필터가 빠지면 벡터 검색이 다른
    사용자의 유사 세션을 끌어와 남의 세션에 이벤트가 append된다.
    """
    try:
        scored = await search_similar_with_scores(
            vector, limit=_CANDIDATE_VECTOR_LIMIT, score_threshold=settings.search_score_threshold
        )
        vector_ids = [session_id for session_id, _score in scored]
        scores_by_id = {session_id: score for session_id, score in scored}
    except Exception as exc:
        logger.warning("후보 세션 벡터 검색 실패(%s) — 벡터 후보 없이 진행", exc)
        vector_ids = []
        scores_by_id = {}

    async with AsyncSessionLocal() as db:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=_CANDIDATE_RECENT_HOURS)
        recent_result = await db.execute(
            select(SessionModel.id)
            .where(
                SessionModel.user_id == user_id,
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
                SessionModel.user_id == user_id,
                # merged 세션은 후보에서 제외 — Qdrant 포인트 삭제가 실패해 벡터 후보로 새어들어도
                # 병합된 세션에 다시 append되지 않게 이중 방어한다(merge P2).
                SessionModel.status == "active",
                func.coalesce(SessionModel.last_activity_at, SessionModel.created_at)
                >= recency_floor,
            )
        )
        sessions_by_id = {s.id: s for s in sessions_result.scalars().all()}

    ordered_sessions = [sessions_by_id[sid] for sid in combined_ids if sid in sessions_by_id]
    return _sessions_to_candidates(ordered_sessions, scores_by_id)


# ── 그룹/배치 처리 ──────────────────────────────────────────────


def _append_blocked(candidate: dict) -> bool:
    """append 게이트 — 후보가 유사도 하한 미달이거나 시간 근접을 벗어나면 True(강등 대상)."""
    score = candidate.get("score")
    # 벡터 매치 후보만 유사도로 판정(최근-only 후보는 score None → 유사도 게이트 우회, recency로만).
    if isinstance(score, (int, float)) and score < settings.append_score_floor:
        return True
    days_ago = candidate.get("last_activity_days_ago")
    if isinstance(days_ago, int) and days_ago > settings.append_max_age_days:
        return True
    return False


def _gate_appends(assignments: list[Assignment], candidates: list[dict]) -> list[Assignment]:
    """append 게이팅(순수 함수) — 유사도 하한/시간 근접 미달 후보로의 append를 create로 강등한다.

    오래됐거나 안 비슷한 후보 세션에 조용히 이어붙는 그룹 간 과잉 append를 결정적으로 막는다
    (DecisionLog 2026-08-05). 강등 시 title/purpose는 그대로 두고(append는 보통 빈 값)
    session_updater가 fallback 제목을 붙인다.
    """
    meta = {c["session_id"]: c for c in candidates if c.get("session_id")}
    gated: list[Assignment] = []
    for assignment in assignments:
        if assignment.action == "append" and assignment.target:
            candidate = meta.get(assignment.target)
            if candidate is not None and _append_blocked(candidate):
                logger.info(
                    "append 게이트 — 후보 %s로의 append를 create로 강등(score=%s, days_ago=%s)",
                    assignment.target,
                    candidate.get("score"),
                    candidate.get("last_activity_days_ago"),
                )
                gated.append(replace(assignment, action="create", target=None))
                continue
        gated.append(assignment)
    return gated


async def _process_group(
    group: list[dict], batch_id: str, touched: set[str], user_id: str
) -> list[str]:
    """그룹 하나를 노이즈 필터 → 서브클러스터링 → (클러스터별) 후보검색·의도분석·게이트 →
    apply_assignments까지 처리한다.

    조건부 하드 스플릿: 서브클러스터가 2개 이상이면 클러스터별로 후보검색+LLM을 분리해
    이질 주제 뭉침을 구조적으로 막는다. 단일주제 그룹은 클러스터 1개 → 호출 1회(기존과 동일).
    반환값은 이 그룹에서 실제 사용된 LLM model명 목록(감사용, 없으면 []).
    """
    # event_filter 재검사(방어) — 인제스트 이후 상태가 바뀌었을 수 있는 시스템 URL을 다시 거른다.
    filtered_group = [e for e in group if not is_system_url(e["url"])]
    filtered_ids = {e["id"] for e in filtered_group}
    discarded_ids = [e["id"] for e in group if e["id"] not in filtered_ids]

    # 노이즈 사전 필터 — 스침 방문(로그인 화면·습관성 도메인·고립 루트)을 LLM 호출 전에
    # 결정적으로 discard한다(LLM 판정 변동성 회피, DecisionLog 2026-08-05).
    filtered_group, noise_ids = split_noise(filtered_group)
    discarded_ids.extend(noise_ids)

    if discarded_ids:
        await _set_status(discarded_ids, "discarded")

    if not filtered_group:
        return []

    # 이벤트별 임베딩(1회 배치 요청) — 서브클러스터링과 클러스터 centroid 후보검색에 재사용한다.
    # 기존 세션(embedding-passage 저장)을 검색하는 쿼리 벡터이므로 embedding-query(기본값)를 쓴다.
    embeddings = await embed_many([_event_embedding_text(e) for e in filtered_group])
    clusters_idx = subcluster(embeddings, settings.subcluster_threshold)

    # phase 1 — 클러스터별 후보검색 + 의도분석 + 게이트. apply 전에 모두 수행해, 클러스터가
    # 서로가 방금 만든 세션을 후보로 잡아 쪼갠 주제를 다시 붙이는 것(재병합)을 막는다.
    pending: list[tuple[list[dict], list[Assignment]]] = []
    models_used: list[str] = []
    for idx_group in clusters_idx:
        cluster_events = [filtered_group[i] for i in idx_group]
        centroid = _centroid([embeddings[i] for i in idx_group])
        candidates = await _fetch_candidates(centroid, user_id)
        assignments = await intent_analyzer.analyze(cluster_events, candidates)
        assignments = _gate_appends(assignments, candidates)
        pending.append((cluster_events, assignments))
        models_used.extend(a.model for a in assignments if a.model)

    # phase 2 — 세션 생성/갱신 반영
    for cluster_events, assignments in pending:
        async with AsyncSessionLocal() as db:
            touched_ids = await apply_assignments(db, cluster_events, assignments, batch_id)
        touched.update(touched_ids)

    return models_used


def _summarize_models(counts: dict[str, int]) -> str | None:
    """그룹별 사용 모델 카운트를 감사용 요약 문자열로(EXAONE/A.X 폴백률 관측). String(50) 상한.

    예: {"exaone/LGAI-EXAONE/K-EXAONE-236B-A23B": 12, "A.X-K1": 3} → "exaone:12,A.X-K1:3"
    """
    if not counts:
        return None

    def _short(model: str) -> str:
        return "exaone" if model.startswith("exaone/") else model

    parts = [f"{_short(m)}:{n}" for m, n in sorted(counts.items(), key=lambda kv: -kv[1])]
    return ",".join(parts)[:50]


async def _run_auto_merge(user_id: str) -> None:
    """자동 병합 실행(배치 후, opt-in). 병합된 생존 세션 재요약 + 흡수 세션 Qdrant 포인트 삭제.

    실패해도 배치 자체는 성공으로 마무리한다(자동 병합은 부가 기능 — 배치 완료를 막지 않는다).
    """
    try:
        async with AsyncSessionLocal() as db:
            merged_pairs = await auto_merge_duplicates(db, user_id)
    except Exception as exc:
        logger.warning("자동 병합 실패: %s", exc)
        return
    for survivor_id, absorbed_id in merged_pairs:
        try:
            await delete_point(absorbed_id)
            await refresh_session_ai(survivor_id)
        except Exception as exc:
            logger.warning("자동 병합 후처리 실패(survivor=%s): %s", survivor_id, exc)
    if merged_pairs:
        logger.info("자동 병합 %d건 완료", len(merged_pairs))


async def _process_batch(batch_id: str, claimed: list[dict], user_id: str) -> None:
    try:
        kept, discarded_ids = dedupe_events(claimed)
        if discarded_ids:
            await _set_status(discarded_ids, "processed")

        groups = group_by_time_gap(kept, gap_minutes=_GAP_MINUTES, max_group_size=_MAX_GROUP_SIZE)

        touched: set[str] = set()
        model_counts: dict[str, int] = {}

        for group in groups:
            try:
                models = await _process_group(group, batch_id, touched, user_id)
                for model in models:
                    model_counts[model] = model_counts.get(model, 0) + 1
            except Exception as exc:
                # 그룹 실패는 해당 그룹 이벤트만 pending 복귀 후 계속(배치 전체 중단 금지).
                logger.warning("배치 그룹 처리 실패(batch_id=%s) — 이벤트 pending 복귀: %s", batch_id, exc)
                await _set_status([e["id"] for e in group], "pending")

        for session_id in touched:
            try:
                await refresh_session_ai(session_id)
            except Exception as exc:
                logger.warning("세션 재요약 실패(session_id=%s): %s", session_id, exc)

        # opt-in 자동 병합(기본 OFF) — 사용자 토글(app_settings, DB) 우선, 없으면 env 기본값.
        # '명백한 중복'만 배치 후 자동 병합(merge-design §2, DecisionLog 2026-08-07).
        if await is_auto_merge_enabled():
            await _run_auto_merge(user_id)

        await _complete_batch(batch_id, event_count=len(claimed), model=_summarize_models(model_counts))
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
        claimed, user_id = await _claim_pending_events(batch_id)
    except Exception as exc:
        await _fail_batch(batch_id, exc)
        _batch_lock.release()
        raise

    if not claimed or user_id is None:
        await _complete_batch(batch_id, event_count=0)
        _batch_lock.release()
        return None

    task = asyncio.create_task(_process_batch(batch_id, claimed, user_id))
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
