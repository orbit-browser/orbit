from collections.abc import Iterator
from unittest.mock import Mock

import pytest
from sqlalchemy.engine import Engine


@pytest.fixture(autouse=True)
def _forbid_database_connections(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    connect = Mock(
        name="Engine.raw_connection",
        side_effect=AssertionError("Real database connections are forbidden in unit tests"),
    )
    # AsyncEngine도 이 경계를 지나므로 커넥션 풀에 닿기 전에 차단한다.
    monkeypatch.setattr(Engine, "raw_connection", connect)

    yield

    # 서비스가 연결 예외를 삼켜도 시험은 실패해야 한다.
    connect.assert_not_called()
