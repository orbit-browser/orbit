from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import ExplorationEvent, SyncBatch
from ..db.session import get_db
from ..schemas.sync import (
    CurrentBatchInfo,
    LastBatchInfo,
    SyncBatchDetail,
    SyncBatchSummary,
    SyncStatusResponse,
    SyncTriggerRequest,
)
from ..services import sync_pipeline
from .deps import current_user_id

router = APIRouter(prefix="/sync", tags=["sync"])


def _to_summary(batch: SyncBatch) -> SyncBatchSummary:
    return SyncBatchSummary(
        batch_id=batch.id,
        trigger_type=batch.trigger_type,
        status=batch.status,
        started_at=batch.started_at.isoformat(),
        completed_at=batch.completed_at.isoformat() if batch.completed_at else None,
        event_count=batch.event_count,
        model=batch.model,
        error_message=batch.error_message,
    )


@router.post("")
async def trigger_sync(body: SyncTriggerRequest) -> JSONResponse:
    """docs/api-design-v2.md §4 — 202(접수)/409(이미 실행 중)/200(pending 없음)."""
    try:
        batch_id = await sync_pipeline.run_batch(body.trigger_type)
    except sync_pipeline.SyncBatchRunningError as exc:
        return JSONResponse(
            status_code=409,
            content={"detail": "Sync batch already running", "batch_id": exc.batch_id},
        )

    if batch_id is None:
        return JSONResponse(status_code=200, content={"batch_id": None, "detail": "No pending events"})
    return JSONResponse(status_code=202, content={"batch_id": batch_id})


@router.get("/status", response_model=SyncStatusResponse)
async def sync_status(
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> SyncStatusResponse:
    running = sync_pipeline.is_running()

    current_batch = None
    if running:
        result = await db.execute(
            select(SyncBatch)
            .where(SyncBatch.status == "running")
            .order_by(SyncBatch.started_at.desc())
            .limit(1)
        )
        batch = result.scalar_one_or_none()
        if batch:
            current_batch = CurrentBatchInfo(
                batch_id=batch.id,
                trigger_type=batch.trigger_type,
                started_at=batch.started_at.isoformat(),
                event_count=batch.event_count,
            )

    pending_result = await db.execute(
        select(func.count())
        .select_from(ExplorationEvent)
        .where(ExplorationEvent.sync_status == "pending", ExplorationEvent.user_id == user_id)
    )
    pending = pending_result.scalar_one()

    last_result = await db.execute(
        select(SyncBatch)
        .where(SyncBatch.status.in_(["completed", "failed"]))
        .order_by(SyncBatch.completed_at.desc())
        .limit(1)
    )
    last = last_result.scalar_one_or_none()
    last_batch = None
    if last:
        last_batch = LastBatchInfo(
            batch_id=last.id,
            status=last.status,
            completed_at=last.completed_at.isoformat() if last.completed_at else None,
            event_count=last.event_count,
        )

    return SyncStatusResponse(
        running=running,
        current_batch=current_batch,
        pending=pending,
        last_batch=last_batch,
    )


@router.get("/batches", response_model=list[SyncBatchSummary])
async def list_batches(
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> list[SyncBatchSummary]:
    result = await db.execute(select(SyncBatch).order_by(SyncBatch.started_at.desc()).limit(limit))
    return [_to_summary(b) for b in result.scalars().all()]


@router.get("/batches/{batch_id}", response_model=SyncBatchDetail)
async def get_batch(batch_id: str, db: AsyncSession = Depends(get_db)) -> SyncBatchDetail:
    batch = await db.get(SyncBatch, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="배치를 찾을 수 없습니다")
    return SyncBatchDetail(**_to_summary(batch).model_dump(), prompt_version=batch.prompt_version)
