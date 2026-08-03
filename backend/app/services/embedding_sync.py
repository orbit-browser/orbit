import logging

from ..ai.embedding import embed
from ..config import settings
from ..db.models import Session as SessionModel
from ..db.session import AsyncSessionLocal
from ..db.vector import upsert_point
from ..schemas.session import SessionSummary

logger = logging.getLogger(__name__)


def build_embedding_text(title: str, summary: SessionSummary) -> str:
    parts = [title, summary.overview, summary.purpose, *summary.highlights]
    return " ".join(part.strip() for part in parts if part.strip())


async def embed_and_upsert(session_id: str, title: str, summary: SessionSummary) -> None:
    """요약 텍스트를 embedding-passage로 임베딩해 Qdrant에 반영. 요약 성공 여부와 독립적으로 상태를 추적."""
    try:
        embed_text = build_embedding_text(title, summary)
        vector = await embed(embed_text, model=settings.embedding_passage_model)
        await upsert_point(session_id, vector, {
            "session_id": session_id,
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
