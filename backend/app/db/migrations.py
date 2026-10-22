"""멱등 ALTER 러너 (docs/migration-plan.md §3). 기존 테이블에 컬럼 추가, VARCHAR 폭 확장, 인덱스 추가만 담당한다.

신규 테이블은 create_all이 생성하므로 대상이 아니다. 컬럼 삭제·축소·그 밖의 타입 변경은 범위 밖.
"""

import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

logger = logging.getLogger(__name__)

# {테이블: [(컬럼명, ALTER 시 타입/제약)]} — additive-only. docs/data-model-v2.md §4, merge-design §5.
_TABLE_COLUMNS: dict[str, list[tuple[str, str]]] = {
    "sessions": [
        ("user_id", "VARCHAR(64) NOT NULL DEFAULT 'local'"),
        ("origin", "VARCHAR(20) NOT NULL DEFAULT 'snapshot'"),
        ("status", "VARCHAR(20) NOT NULL DEFAULT 'active'"),
        ("started_at", "TIMESTAMPTZ"),
        ("last_activity_at", "TIMESTAMPTZ"),
        ("total_active_duration_ms", "BIGINT NOT NULL DEFAULT 0"),
        ("event_count", "INTEGER NOT NULL DEFAULT 0"),
        ("keywords", "JSONB NOT NULL DEFAULT '[]'"),
        ("confidence", "REAL"),
        ("merged_into", "VARCHAR(36)"),  # 병합 생존 세션 id (merge P0)
        ("folder_id", "VARCHAR(36)"),  # 사용자 폴더 소속. NULL=미정리
        ("folder_assigned_by", "VARCHAR(10)"),  # 폴더 소속을 정한 주체 user|auto. NULL=미결정
        ("alias", "VARCHAR(100)"),  # 사용자가 붙인 표시 이름. NULL=title 사용
        ("collect_workspace_id", "VARCHAR(36)"),  # 팀 수집 스트림. NULL=개인 (docs/team-collect-mode.md §4.1)
    ],
    "exploration_events": [
        ("workspace_id", "VARCHAR(36)"),  # 서버 판정을 통과한 팀 수집 방문의 팀. NULL=개인
        ("collect_window_id", "VARCHAR(36)"),  # 판정에 쓴 수집 창
    ],
    "workspaces": [
        ("collect_allowed", "BOOLEAN NOT NULL DEFAULT false"),  # owner 의 팀 수집 허용
    ],
    "session_events": [
        ("merged_from_session_id", "VARCHAR(36)"),  # 병합으로 옮겨온 원 세션 id (merge P2, undo용)
    ],
}

# {(테이블, 컬럼): VARCHAR 길이} — 현재 길이가 더 작을 때만 넓힌다. Postgres는 varchar 확장에 테이블을 다시 쓰지 않는다.
_VARCHAR_WIDTHS: dict[tuple[str, str], int] = {
    ("exploration_events", "content_excerpt"): 16000,  # 본문 상한 5000 → 16000 (docs/data-model-v2.md §1)
}

# 이미 있는 테이블에 더하는 인덱스. create_all 은 기존 테이블에 새 인덱스를 만들지 않는다.
# 개발 단계 규모라 기동 시 생성으로 충분하다(CONCURRENTLY 는 트랜잭션 밖이어야 해서 러너 구조가 바뀐다).
_INDEXES: dict[str, str] = {
    "ix_exploration_events_stream": (
        "CREATE INDEX IF NOT EXISTS ix_exploration_events_stream "
        "ON exploration_events (user_id, workspace_id, sync_status, visited_at)"
    ),
    "ix_exploration_events_collect_window": (
        "CREATE INDEX IF NOT EXISTS ix_exploration_events_collect_window "
        "ON exploration_events (collect_window_id) WHERE collect_window_id IS NOT NULL"
    ),
    "ix_sessions_collect_workspace_id": (
        "CREATE INDEX IF NOT EXISTS ix_sessions_collect_workspace_id "
        "ON sessions (collect_workspace_id) WHERE collect_workspace_id IS NOT NULL"
    ),
}


async def run_migrations(conn: AsyncConnection) -> None:
    """이미 존재하는 컬럼은 건너뛰고, 없는 컬럼만 추가한다.

    실패 시 예외를 전파해 부팅을 중단한다(docs/migration-plan.md §3) —
    컬럼이 누락된 채 기동하면 ORM이 새 컬럼을 참조하는 모든 조회가 500이 된다.
    """
    for table, columns in _TABLE_COLUMNS.items():
        for column, ddl in columns:
            exists = await conn.scalar(
                text(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_name = :table AND column_name = :column"
                ),
                {"table": table, "column": column},
            )
            if exists:
                continue
            await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
            logger.info("%s.%s column added", table, column)

    for (table, column), length in _VARCHAR_WIDTHS.items():
        current = await conn.scalar(
            text(
                "SELECT character_maximum_length FROM information_schema.columns "
                "WHERE table_name = :table AND column_name = :column"
            ),
            {"table": table, "column": column},
        )
        # None: 컬럼 없음(create_all 몫) 또는 길이 제한 없는 타입
        if current is None or current >= length:
            continue
        await conn.execute(text(f"ALTER TABLE {table} ALTER COLUMN {column} TYPE VARCHAR({length})"))
        logger.info("%s.%s widened to VARCHAR(%d)", table, column, length)

    for name, ddl in _INDEXES.items():
        exists = await conn.scalar(
            text("SELECT 1 FROM pg_indexes WHERE indexname = :name"), {"name": name}
        )
        if exists:
            continue
        await conn.execute(text(ddl))
        logger.info("index %s created", name)
