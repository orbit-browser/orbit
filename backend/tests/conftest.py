import socket
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


@pytest.fixture(autouse=True)
def _forbid_network_connections(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Qdrant·LLM·임베딩 같은 외부 서비스로 나가는 TCP 연결을 막는다.

    `delete_point`, `init_collection`처럼 예외를 삼키는 함수가 대역 없이 불리면 개발 Qdrant(6333)에
    조용히 쓸 수 있다. 루프백도 막는다 — 개발 서버가 루프백에 떠 있기 때문이다. 이벤트 루프의
    socketpair(AF_UNIX)와 httpx ASGITransport는 connect를 쓰지 않아 영향이 없다.
    """
    attempts: list[str] = []
    original = socket.socket.connect
    original_ex = socket.socket.connect_ex

    def _blocked(sock: socket.socket, address: object) -> bool:
        if sock.family in (socket.AF_INET, socket.AF_INET6):
            attempts.append(repr(address))
            return True
        return False

    def guarded(self: socket.socket, address: object) -> None:
        if _blocked(self, address):
            raise ConnectionRefusedError("Network connections are forbidden in unit tests")
        return original(self, address)

    def guarded_ex(self: socket.socket, address: object) -> int:
        if _blocked(self, address):
            raise ConnectionRefusedError("Network connections are forbidden in unit tests")
        return original_ex(self, address)

    monkeypatch.setattr(socket.socket, "connect", guarded)
    monkeypatch.setattr(socket.socket, "connect_ex", guarded_ex)

    yield

    # 서비스가 연결 예외를 삼켜도(경고 로그만 남기고 계속) 시험은 실패해야 한다.
    assert not attempts, f"network connection attempted: {attempts}"
