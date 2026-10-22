import uuid
from datetime import datetime, timezone

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, REAL, String, Text, UniqueConstraint, func, text
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
    # 병합(merge) — 흡수된 세션이 가리키는 생존 세션 id. NULL=병합 안 됨(docs/merge-design.md §5).
    # 기록은 P2 병합 실행부터. P0에서는 컬럼만 준비(additive).
    merged_into: Mapped[str | None] = mapped_column(String(36), default=None)
    # 사용자가 만든 폴더 소속. NULL=미정리. 세션은 폴더 하나에만 속한다(단일 소속).
    # FK를 걸지 않는다 — 이 컬럼은 기존 테이블에 ALTER로 추가되고, 폴더 삭제는
    # 애플리케이션에서 NULL 되돌리기로 처리한다. 조회 측은 존재하지 않는 폴더 id를
    # 미정리로 간주해 방어한다.
    folder_id: Mapped[str | None] = mapped_column(String(36), default=None, index=True)
    # 폴더 소속을 누가 정했는지. user=사용자(옮김·뺌·제안 닫기), auto=자동 분류, NULL=아직 아무도 정하지 않음.
    # 자동 분류는 NULL인 세션만 다루고, 근거로는 사용자가 넣은 세션만 쓴다(docs/DecisionLog.md 2026-10-20).
    # 기능 이전에 폴더에 들어간 세션은 NULL이지만 사용자가 넣은 것이다.
    folder_assigned_by: Mapped[str | None] = mapped_column(String(10), default=None)

    # 사용자가 붙인 표시용 이름. NULL이면 title을 그대로 보여준다.
    #
    # title을 직접 고치지 않는 이유: title은 임베딩 텍스트(_embed_and_upsert),
    # 병합 게이팅의 제목 Jaccard(merge_service), 추천 term 추출의 기준이고,
    # 배치 세션화가 매번 다시 만들어 낸다(session_updater). 사용자가 고친 이름을
    # 거기에 실으면 저장된 벡터와 어긋나고 배치가 덮어쓴다.
    alias: Mapped[str | None] = mapped_column(String(100), default=None)

    # 팀 수집 스트림(docs/team-collect-mode.md §3.3, §4.1). 이 팀의 수집 창 방문으로 만들어진 세션이면 그 팀 id,
    # 개인 스트림이면 NULL. 배치는 같은 스트림의 세션에만 이어 붙인다 — 공유 행(WorkspaceSession)과는 다른 값이다.
    # 수동 공유한 개인 세션은 팀에 보여도 개인 스트림이다. FK 없음(팀 삭제 정리가 먼저 비운다).
    collect_workspace_id: Mapped[str | None] = mapped_column(String(36), default=None)


def session_display_title(session: Session) -> str:
    """사용자에게 보여 줄 세션 이름. **응답 경계에서만** 쓴다.

    내부 로직(임베딩·병합 점수·프롬프트 term 추출)은 session.title을 그대로 봐야 한다.
    파생 프로퍼티가 아니라 함수인 이유: 매퍼를 검증하는 테스트 대역이 실제 컬럼(alias)만
    흉내 내면 되고, 파생 규칙을 대역이 따라 적을 필요가 없다.
    """
    return session.alias or session.title


# 컬럼만 뽑는 조회(ORM 객체가 없는 select)에서 쓰는 표시 이름.
SESSION_DISPLAY_TITLE = func.coalesce(Session.alias, Session.title)


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
    content_excerpt: Mapped[str | None] = mapped_column(String(16000), default=None)
    content_hash: Mapped[str | None] = mapped_column(String(64), default=None)
    # pending | processing | processed | discarded
    sync_status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    hold_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    # 팀 수집(docs/team-collect-mode.md §2.2). 서버 인제스트 판정을 통과한 방문만 채워진다. 둘 다 NULL이면 개인 스트림.
    # collect_window_id 는 판정에 쓴 수집 창 — 빼기(withdraw)와 되돌리기(restore)가 이 값으로 고른다. FK 없음.
    workspace_id: Mapped[str | None] = mapped_column(String(36), default=None)
    collect_window_id: Mapped[str | None] = mapped_column(String(36), default=None)


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
    # 병합(merge P2) — 이 행이 병합으로 옮겨온 원 세션 id. NULL=원래 이 세션 소속. undo 복원 기준.
    merged_from_session_id: Mapped[str | None] = mapped_column(String(36), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class UserSetting(Base):
    """사용자별 설정 — key-value. 런타임에 사용자가 토글하는 선호값을 저장한다.

    env(config)는 기본값, 이 테이블 값이 있으면 우선. 신규 테이블이라 create_all이 생성한다.
    단일 사용자 시절의 전역 `app_settings` 테이블은 읽지 않는다 — 그 값은 누군가의 opt-in이라
    다른 사용자에게 물려주면 자동병합 같은 파괴적 기능이 동의 없이 켜진다.
    """

    __tablename__ = "user_settings"

    user_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[object] = mapped_column(JSONB, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )


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


class User(Base):
    """구글 계정으로 가입한 사용자.

    비밀번호는 저장하지 않는다 — 인증은 구글에만 위임한다.
    `google_sub` 는 구글이 보장하는 계정 불변 식별자로, 이메일이 바뀌어도 유지된다.
    따라서 사용자 매칭 기준은 email 이 아니라 sub 다.
    """

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_uuid)
    google_sub: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(320), index=True)
    name: Mapped[str | None] = mapped_column(String(200), default=None)
    picture: Mapped[str | None] = mapped_column(Text, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    last_login_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class Folder(Base):
    """사용자가 직접 만드는 세션 폴더 (주제 그룹).

    자동 클러스터링이 아니라 수동 정리 수단이다. 세션은 폴더 하나에만 속하며
    (`Session.folder_id`), 폴더를 지워도 세션은 남고 소속만 풀린다.
    """

    __tablename__ = "folders"
    __table_args__ = (
        Index("ix_folders_user_position", "user_id", "position"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_uuid)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(60))
    # 캔버스 중심 노드와 궤도에 쓰는 색. 생성 시 팔레트에서 순환 배정한다.
    hue: Mapped[str] = mapped_column(String(20))
    # 사용자가 정한 표시 순서. 같은 값이면 created_at 으로 결정적으로 정렬한다.
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )


class RecommendationCache(Base):
    """사용자별 추천 세션 캐시 (stale-while-revalidate).

    새 탭은 하루에 수십 번 열린다. 열 때마다 LLM을 부르지 않기 위해 결과를 저장해 두고,
    TTL이 지나면 응답은 캐시로 주면서 백그라운드에서 다시 계산한다.
    """

    __tablename__ = "recommendation_cache"

    user_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    #: [{session_id, title, kind, reason, score}, ...]
    items: Mapped[list] = mapped_column(JSONB, default=list)
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class Workspace(Base):
    """팀 워크스페이스. 팀원이 서로의 세션을 공유해 함께 보는 공간이다.

    소유자는 `WorkspaceMember.role='owner'` 로만 표현한다 — 여기 컬럼으로 중복해 두지 않는다.
    초대 코드는 평문을 저장하지 않고 해시만 둔다(DB가 새도 코드가 드러나지 않게). 재발급하면
    해시가 바뀌어 이전 코드가 무효가 된다.
    """

    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_uuid)
    name: Mapped[str] = mapped_column(String(60))
    hue: Mapped[str] = mapped_column(String(20))
    invite_code_hash: Mapped[str | None] = mapped_column(String(64), default=None, index=True)
    invite_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    # owner 가 켜는 팀 수집 허용(docs/team-collect-mode.md §1.1). 끄면 그 팀의 열린 수집 창이 모두 끝난다.
    collect_allowed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )


class WorkspaceMember(Base):
    """워크스페이스 멤버십. role 은 'owner' | 'member'."""

    __tablename__ = "workspace_members"

    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(String(64), primary_key=True, index=True)
    role: Mapped[str] = mapped_column(String(20))
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class WorkspaceSession(Base):
    """세션 공유 — 원본 세션을 가리키는 라이브 참조다.

    사본을 만들지 않으므로 공유 뒤 Auto Session이 붙인 페이지도 팀에 보인다. 공유는 세션 소유자만
    할 수 있어 `shared_by` 는 곧 세션 소유자다. FK에 ON DELETE가 없어 세션·워크스페이스를 지울 때
    이 행을 먼저 지운다.
    """

    __tablename__ = "workspace_sessions"

    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id"), primary_key=True
    )
    session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("sessions.id"), primary_key=True, index=True
    )
    shared_by: Mapped[str] = mapped_column(String(64))
    shared_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class WorkspaceCollectWindow(Base):
    """팀 수집 창 — 한 사람이 한 기기에서 팀 수집을 켠 구간(docs/team-collect-mode.md §1.2, §4.1).

    현재 상태 열이 아니라 이력 행인 이유: 로컬 큐는 오프라인이면 몇 시간 뒤에 보내므로, 늦게 도착한 방문도
    "그때 켜져 있었는가"로 판정해야 한다. 활성 = ended_at IS NULL 이고 expires_at 이 지나지 않음.
    한 사람·한 기기에 끝나지 않은 창은 하나뿐이다(부분 유니크) — 시작 요청이 경합해도 둘이 생기지 않는다.
    """

    __tablename__ = "workspace_collect_windows"
    __table_args__ = (
        Index("ix_collect_windows_lookup", "workspace_id", "user_id", "device_id", "started_at"),
        Index(
            "ux_collect_windows_open",
            "user_id",
            "device_id",
            unique=True,
            postgresql_where=text("ended_at IS NULL"),
            sqlite_where=text("ended_at IS NULL"),
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_uuid)
    workspace_id: Mapped[str] = mapped_column(String(36), ForeignKey("workspaces.id"))
    user_id: Mapped[str] = mapped_column(String(64))
    device_id: Mapped[str] = mapped_column(String(64))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    # stop|pause|switch|expired|browser_restart|account_switch|left|removed|disallowed|team_deleted
    ended_reason: Mapped[str | None] = mapped_column(String(20), default=None)
    # 돌아보기의 "남은 방문 모두 빼기". 이후 이 창을 가리키는 방문은 팀으로 받지 않는다.
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
