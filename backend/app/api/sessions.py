from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import Session as SessionModel
from ..db.session import get_db
from ..schemas.session import (
    PatchSessionRequest,
    SaveSessionRequest,
    SaveSessionResponse,
    SessionDetail,
    SessionSummary,
    TabItemResponse,
)
from ..services.summarizer import generate_summary

router = APIRouter(prefix="/sessions", tags=["sessions"])


def _to_detail(session: SessionModel) -> SessionDetail:
    tabs = [
        TabItemResponse(
            id=str(t.get("id", "")),
            title=t.get("title", ""),
            url=t.get("url", ""),
            fav_icon_url=t.get("favIconUrl"),
        )
        for t in (session.tabs or [])
    ]
    summary_data = session.summary or {}
    summary = SessionSummary(
        overview=summary_data.get("overview", ""),
        purpose=summary_data.get("purpose", ""),
        highlights=summary_data.get("highlights", []),
        todos=summary_data.get("todos", []),
        next_actions=summary_data.get("next_actions", []),
    )
    return SessionDetail(
        session_id=session.id,
        title=session.title,
        summary=summary,
        tabs=tabs,
        created_at=session.created_at.isoformat(),
        updated_at=session.updated_at.isoformat(),
    )


@router.post("", response_model=SaveSessionResponse, status_code=201)
async def create_session(
    body: SaveSessionRequest,
    db: AsyncSession = Depends(get_db),
) -> SaveSessionResponse:
    title, summary = await generate_summary(body.tabs)

    session = SessionModel(
        title=title,
        tabs=[t.model_dump() for t in body.tabs],
        summary=summary.model_dump(),
        tab_count=len(body.tabs),
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    return SaveSessionResponse(
        session_id=session.id,
        title=session.title,
        summary=summary,
        created_at=session.created_at.isoformat(),
    )


@router.get("", response_model=list[SessionDetail])
async def list_sessions(
    db: AsyncSession = Depends(get_db),
) -> list[SessionDetail]:
    result = await db.execute(
        select(SessionModel).order_by(SessionModel.created_at.desc())
    )
    return [_to_detail(s) for s in result.scalars().all()]


@router.get("/{session_id}", response_model=SessionDetail)
async def get_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
) -> SessionDetail:
    session = await db.get(SessionModel, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    return _to_detail(session)


@router.patch("/{session_id}", response_model=SessionDetail)
async def patch_session(
    session_id: str,
    body: PatchSessionRequest,
    db: AsyncSession = Depends(get_db),
) -> SessionDetail:
    session = await db.get(SessionModel, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")

    session.title = body.title
    session.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(session)
    return _to_detail(session)


@router.delete("/{session_id}", status_code=204)
async def delete_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
) -> None:
    session = await db.get(SessionModel, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    await db.delete(session)
    await db.commit()
