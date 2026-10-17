import logging
from collections import defaultdict

from sqlalchemy import select

from ..ai.embedding import embed
from ..config import settings
from ..db.models import Session as SessionModel
from ..db.session import AsyncSessionLocal
from ..db.vector import point_ids_missing_owner, set_owner, upsert_point
from ..schemas.session import SessionSummary

logger = logging.getLogger(__name__)


def build_embedding_text(title: str, summary: SessionSummary) -> str:
    parts = [title, summary.overview, summary.purpose, *summary.highlights]
    return " ".join(part.strip() for part in parts if part.strip())


async def embed_and_upsert(session_id: str, title: str, summary: SessionSummary) -> None:
    """요약 텍스트를 embedding-passage로 임베딩해 Qdrant에 반영. 요약 성공 여부와 독립적으로 상태를 추적."""
    try:
        async with AsyncSessionLocal() as db:
            user_id = await db.scalar(
                select(SessionModel.user_id).where(SessionModel.id == session_id)
            )
        if user_id is None:
            return  # 그 사이 삭제된 세션 — 고아 포인트를 만들지 않는다
        embed_text = build_embedding_text(title, summary)
        vector = await embed(embed_text, model=settings.embedding_passage_model)
        await upsert_point(session_id, vector, {
            "session_id": session_id,
            "user_id": user_id,
            "title": title,
            "overview": summary.overview,
            "purpose": summary.purpose,
        })
        async with AsyncSessionLocal() as db:
            session = await db.get(SessionModel, session_id)
            if session:
                session.embedding_status = "done"
                await db.commit()
    except Exception as exc:
        logger.warning("임베딩/Qdrant upsert 실패 (session_id=%s): %s", session_id, exc)
        async with AsyncSessionLocal() as db:
            session = await db.get(SessionModel, session_id)
            if session:
                session.embedding_status = "failed"
                await db.commit()


async def backfill_owner_payload() -> None:
    """소유자 payload가 없는 기존 포인트에 `user_id`를 채운다. 기동 시 실행하며 멱등이다.

    DB에 없는 세션의 포인트는 그대로 둔다 — 소유자 필터에 걸리지 않으므로 검색에 나오지 않는다.
    """
    try:
        missing = await point_ids_missing_owner()
        if not missing:
            return
        async with AsyncSessionLocal() as db:
            rows = (
                await db.execute(
                    select(SessionModel.id, SessionModel.user_id).where(SessionModel.id.in_(missing))
                )
            ).all()
        by_owner: dict[str, list[str]] = defaultdict(list)
        for session_id, user_id in rows:
            by_owner[user_id].append(session_id)
        for user_id, session_ids in by_owner.items():
            await set_owner(user_id, session_ids)
        logger.info(
            "Qdrant 소유자 payload backfill: %d건 반영, DB에 없는 포인트 %d건 유지",
            len(rows), len(missing) - len(rows),
        )
    except Exception as exc:
        logger.warning("Qdrant 소유자 payload backfill 실패 (%s) — 다음 기동 때 재시도", exc)
