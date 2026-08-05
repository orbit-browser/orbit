import uuid
from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, Integer, REAL, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _new_uuid() -> str:
    return str(uuid.uuid4())


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

    # ── Auto Session 확장 (docs/data-model-v2.md §4, additive-only) ──────
    user_id: Mapped[str] = mapped_column(String(64), default="local")
    # snapshot: 기존 스냅샷 경로(POST /sessions, /sessions/cluster) | events: Auto Session 배치가 생성
    origin: Mapped[str] = mapped_column(String(20), default="snapshot")
    status: Mapped[str] = mapped_column(String(20), default="active")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    last_activity_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    total_active_duration_ms: Mapped[int] = mapped_column(BigInteger, default=0)
    event_count: Mapped[int] = mapped_column(Integer, default=0)
    keywords: Mapped[list] = mapped_column(JSONB, default=list)
    confidence: Mapped[float | None] = mapped_column(REAL, default=None)


class ExplorationEvent(Base):
    """Memory의 원자 단위 — 방문 이벤트 원본 기록 (docs/data-model-v2.md §1)."""

    __tablename__ = "exploration_events"

    # 클라이언트가 생성한 UUID 문자열 그대로 PK로 사용 — 멱등 전송(on_conflict_do_nothing)의 기준
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), default="local", index=True)
    device_id: Mapped[str | None] = mapped_column(String(64), default=None)
    source: Mapped[str] = mapped_column(String(20), default="browser")
    url: Mapped[str] = mapped_column(Text)
    normalized_url: Mapped[str] = mapped_column(Text, index=True)
    title: Mapped[str | None] = mapped_column(String(500), default=None)
    domain: Mapped[str | None] = mapped_column(String(255), default=None, index=True)
    search_query: Mapped[str | None] = mapped_column(Text, default=None)
    visited_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    active_duration_ms: Mapped[int | None] = mapped_column(Integer, default=None)
    tab_id: Mapped[int | None] = mapped_column(Integer, default=None)
    window_id: Mapped[int | None] = mapped_column(Integer, default=None)
    # 소프트 참조(FK 없음) — 참조 대상이 필터로 제외되거나 아직/영영 미동기화일 수 있어
    # FK를 걸면 배치 인제스트 전체가 IntegrityError로 실패한다
    previous_event_id: Mapped[str | None] = mapped_column(String(36), default=None)
    referrer_url: Mapped[str | None] = mapped_column(Text, default=None)
    # visit | spa_nav (Stage 2·3 확장 지점 — docs/data-model-v2.md §7)
    event_type: Mapped[str] = mapped_column(String(20), default="visit")
    content_excerpt: Mapped[str | None] = mapped_column(String(5000), default=None)
    content_hash: Mapped[str | None] = mapped_column(String(64), default=None)
    # pending | processing | processed | discarded
    sync_status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    hold_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class SyncBatch(Base):
    """배치 실행 기록 (docs/data-model-v2.md §2)."""

    __tablename__ = "sync_batches"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_uuid)
    user_id: Mapped[str] = mapped_column(String(64), default="local")
    # manual | periodic | event_count | idle
    trigger_type: Mapped[str] = mapped_column(String(20))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    # running | completed | failed
    status: Mapped[str] = mapped_column(String(20), default="running")
    model: Mapped[str | None] = mapped_column(String(50), default=None)
    prompt_version: Mapped[str | None] = mapped_column(String(20), default=None)
    event_count: Mapped[int | None] = mapped_column(Integer, default=None)
    error_message: Mapped[str | None] = mapped_column(Text, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class SyncBatchEvent(Base):
    """배치-이벤트 연결(감사 로그) (docs/data-model-v2.md §3)."""

    __tablename__ = "sync_batch_events"

    batch_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("sync_batches.id"), primary_key=True
    )
    event_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("exploration_events.id"), primary_key=True
    )


class SessionEvent(Base):
    """Session Timeline 저장 구조 (docs/data-model-v2.md §5)."""

    __tablename__ = "session_events"
    __table_args__ = (
        Index("ix_session_events_session_sequence", "session_id", "sequence_order"),
    )

    session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("sessions.id"), primary_key=True
    )
    event_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("exploration_events.id"), primary_key=True
    )
    relevance_score: Mapped[float | None] = mapped_column(REAL, default=None)
    sequence_order: Mapped[int] = mapped_column(Integer)
    # llm(기본) | rule(fallback) | user(MVP 범위 밖, 값만 예약)
    assigned_by: Mapped[str] = mapped_column(String(20), default="llm")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class SessionVersion(Base):
    """세션 요약 이력 (docs/data-model-v2.md §6)."""

    __tablename__ = "session_versions"
    __table_args__ = (
        UniqueConstraint("session_id", "version", name="uq_session_versions_session_version"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_uuid)
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("sessions.id"))
    version: Mapped[int] = mapped_column(Integer)
    title: Mapped[str | None] = mapped_column(String(100), default=None)
    overview: Mapped[str | None] = mapped_column(Text, default=None)
    purpose: Mapped[str | None] = mapped_column(Text, default=None)
    highlights: Mapped[list] = mapped_column(JSONB, default=list)
    todos: Mapped[list] = mapped_column(JSONB, default=list)
    next_actions: Mapped[list] = mapped_column(JSONB, default=list)
    prompt_version: Mapped[str | None] = mapped_column(String(20), default=None)
    model: Mapped[str | None] = mapped_column(String(50), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
