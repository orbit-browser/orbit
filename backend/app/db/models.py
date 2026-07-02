import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    title: Mapped[str] = mapped_column(String(100))
    tabs: Mapped[list] = mapped_column(JSONB, default=list)
    summary: Mapped[dict] = mapped_column(JSONB, default=dict)
    tab_count: Mapped[int] = mapped_column(Integer, default=0)
    # AI 요약 진행 상태: pending | done | failed (A1 — 무한 스피너 방지)
    summary_status: Mapped[str] = mapped_column(String(20), default="pending")
    # Qdrant 임베딩 진행 상태: pending | done | failed (A5 — 검색 누락 복구용, UI에는 노출 안 함)
    embedding_status: Mapped[str] = mapped_column(String(20), default="pending")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )
