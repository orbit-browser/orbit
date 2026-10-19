import asyncio

from app.db.migrations import run_migrations


class _FakeConn:
    """information_schema 조회에 답하고 실행된 ALTER를 기록한다. 추가 대상 컬럼은 모두 이미 있다고 본다."""

    def __init__(self, widths: dict[tuple[str, str], int | None]):
        self._widths = widths
        self.executed: list[str] = []

    async def scalar(self, stmt, params):
        if "character_maximum_length" in str(stmt):
            return self._widths.get((params["table"], params["column"]))
        return 1

    async def execute(self, stmt):
        self.executed.append(str(stmt))


def test_widens_content_excerpt_when_narrower():
    conn = _FakeConn({("exploration_events", "content_excerpt"): 5000})
    asyncio.run(run_migrations(conn))
    assert conn.executed == [
        "ALTER TABLE exploration_events ALTER COLUMN content_excerpt TYPE VARCHAR(16000)"
    ]


def test_skips_widen_when_already_wide_enough_or_missing():
    for current in (16000, 20000, None):
        conn = _FakeConn({("exploration_events", "content_excerpt"): current})
        asyncio.run(run_migrations(conn))
        assert conn.executed == []
