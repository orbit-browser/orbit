from collections.abc import Iterator

import pytest
from sqlalchemy.engine import Engine


@pytest.fixture(autouse=True)
def _forbid_database_connections(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    original = Engine.raw_connection
    attempts: list[str] = []

    def guarded(self: Engine):
        # 메모리 SQLite는 시험이 직접 만든 DB라 허용한다(보안 시험이 실제 SQL을 돌린다).
        if self.url.get_backend_name() == "sqlite":
            return original(self)
        attempts.append(self.url.render_as_string(hide_password=True))
        raise AssertionError("Real database connections are forbidden in unit tests")

    # AsyncEngine도 이 경계를 지나므로 커넥션 풀에 닿기 전에 차단한다.
    monkeypatch.setattr(Engine, "raw_connection", guarded)

    yield

    # 서비스가 연결 예외를 삼켜도 시험은 실패해야 한다.
    assert not attempts, f"database connection attempted: {attempts}"
