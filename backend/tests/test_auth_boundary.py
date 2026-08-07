"""API 경계 테스트 — 토큰 없이 데이터에 닿을 수 있는 경로가 하나도 없어야 한다.

라우터 내부 구조를 들여다보는 대신 **실제로 요청을 보내 401을 확인한다.**
FastAPI 내부 표현은 버전에 따라 바뀌지만, "토큰 없이 호출하면 거부된다"는 계약은 변하지 않는다.
"""

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.main import app

# 인증 없이 열려 있어야 하는 경로. 이 목록에 없는 경로는 전부 토큰을 요구해야 한다.
_PUBLIC_PATHS = {
    "/health",
    "/auth/google",
    "/docs",
    "/docs/oauth2-redirect",
    "/redoc",
    "/openapi.json",
}

# 경로 파라미터에 넣을 더미 값 — 인증이 먼저 걸리므로 실제로 조회되지 않는다.
_DUMMY_PATH_VALUE = "00000000-0000-0000-0000-000000000000"


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app, raise_server_exceptions=False)


def _all_paths() -> list[tuple[str, str]]:
    """OpenAPI 스키마에서 (method, path) 를 모은다 — 라우터 중첩 구조에 의존하지 않는다."""
    schema = app.openapi()
    out: list[tuple[str, str]] = []
    for path, operations in schema["paths"].items():
        for method in operations:
            if method.upper() in {"GET", "POST", "PATCH", "PUT", "DELETE"}:
                out.append((method.upper(), path))
    return out


def _protected_paths() -> list[tuple[str, str]]:
    return [(m, p) for m, p in _all_paths() if p not in _PUBLIC_PATHS]


def _fill(path: str) -> str:
    """`/sessions/{session_id}` → `/sessions/<dummy>`"""
    out = path
    while "{" in out:
        start = out.index("{")
        end = out.index("}", start)
        out = out[:start] + _DUMMY_PATH_VALUE + out[end + 1 :]
    return out


def test_protected_routes_exist():
    """경로가 0개면 아래 테스트가 공허하게 통과한다 — 방어."""
    assert len(_protected_paths()) > 10


@pytest.mark.parametrize("method,path", _protected_paths())
def test_route_rejects_request_without_token(client: TestClient, method: str, path: str):
    response = client.request(method, _fill(path), json={})

    # 401이어야 한다. 422(검증 실패)면 인증보다 본문 검증이 먼저 돈다는 뜻이고,
    # 그 밖의 코드는 인증을 아예 통과했다는 뜻이라 둘 다 실패로 본다.
    assert response.status_code == 401, (
        f"{method} {path} 가 토큰 없이 {response.status_code} 를 돌려줬습니다"
    )


@pytest.mark.parametrize("method,path", _protected_paths())
def test_route_rejects_garbage_token(client: TestClient, method: str, path: str):
    response = client.request(
        method, _fill(path), json={}, headers={"Authorization": "Bearer not-a-real-token"}
    )
    assert response.status_code == 401


def test_health_stays_public(client: TestClient):
    assert client.get("/health").status_code == 200


def test_login_endpoint_stays_public(client: TestClient):
    """로그인 엔드포인트가 인증을 요구하면 아무도 로그인할 수 없다."""
    response = client.post("/auth/google", json={"access_token": "x"})
    assert response.status_code != 401 or "로그인이 필요합니다" not in response.text


def test_openapi_lists_auth_routes():
    paths = {route.path for route in app.routes if isinstance(route, APIRoute)} | set(
        app.openapi()["paths"]
    )
    for expected in ("/auth/google", "/auth/me", "/auth/logout"):
        assert expected in paths
