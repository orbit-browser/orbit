"""멱등 ALTER 러너 (docs/migration-plan.md §3). sessions 테이블에 컬럼 추가만 담당한다.

신규 5테이블은 create_all이 생성하므로 대상이 아니다. 컬럼 삭제·타입 변경은 범위 밖.
"""

import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

logger = logging.getLogger(__name__)

# (컬럼명, ALTER 시 사용할 타입/제약) — docs/data-model-v2.md §4 순서 그대로
_SESSIONS_COLUMNS: list[tuple[str, str]] = [
    ("user_id", "VARCHAR(64) NOT NULL DEFAULT 'local'"),
    ("origin", "VARCHAR(20) NOT NULL DEFAULT 'snapshot'"),
    ("status", "VARCHAR(20) NOT NULL DEFAULT 'active'"),
    ("started_at", "TIMESTAMPTZ"),
    ("last_activity_at", "TIMESTAMPTZ"),
    ("total_active_duration_ms", "BIGINT NOT NULL DEFAULT 0"),
    ("event_count", "INTEGER NOT NULL DEFAULT 0"),
    ("keywords", "JSONB NOT NULL DEFAULT '[]'"),
    ("confidence", "REAL"),
]


async def run_migrations(conn: AsyncConnection) -> None:
    """이미 존재하는 컬럼은 건너뛰고, 없는 컬럼만 추가한다.

    실패 시 예외를 전파해 부팅을 중단한다(docs/migration-plan.md §3) —
    컬럼이 누락된 채 기동하면 ORM이 새 컬럼을 참조하는 모든 조회가 500이 된다.
    """
    for column, ddl in _SESSIONS_COLUMNS:
        exists = await conn.scalar(
            text(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_name = 'sessions' AND column_name = :column"
            ),
            {"column": column},
        )
        if exists:
            continue
        await conn.execute(text(f"ALTER TABLE sessions ADD COLUMN {column} {ddl}"))
        logger.info("sessions.%s column added", column)
