"""공용 서버 CORS — 허용 목록에 있는 출처만 응답 헤더를 받는다.

Bearer 토큰 방식이라 쿠키 CSRF는 없지만, `*`로 열면 아무 웹페이지나 브라우저에서 API를 두드린다.
"""

from fastapi.testclient import TestClient

from app.config import DEFAULT_CORS_ORIGIN, Settings, parse_cors_origins
from app.main import app

_EXTENSION = "chrome-extension://aghgamoeifieijjckhpfkmhiibacnhml"


def _preflight(origin: str):
    client = TestClient(app)
    return client.options(
        "/sessions",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )


def test_default_origin_is_the_pinned_extension_id():
    assert DEFAULT_CORS_ORIGIN == _EXTENSION
    assert Settings.model_fields["cors_allow_origins"].default == _EXTENSION


def test_preflight_from_extension_gets_allow_origin():
    resp = _preflight(_EXTENSION)
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == _EXTENSION


def test_preflight_from_unlisted_web_page_gets_no_allow_origin():
    resp = _preflight("https://evil.example")
    assert "access-control-allow-origin" not in resp.headers


def test_simple_request_from_unlisted_origin_gets_no_allow_origin():
    resp = TestClient(app).get("/health", headers={"Origin": "https://evil.example"})
    assert resp.status_code == 200
    assert "access-control-allow-origin" not in resp.headers


def test_parse_splits_and_trims_comma_list():
    assert parse_cors_origins(" chrome-extension://a , http://localhost:5173 ,") == [
        "chrome-extension://a",
        "http://localhost:5173",
    ]


def test_parse_empty_value_falls_back_to_extension_not_wildcard():
    # 운영 env에서 실수로 비워도 `*`로 열리지 않는다.
    assert parse_cors_origins("") == [_EXTENSION]
    assert parse_cors_origins(" , ") == [_EXTENSION]


def test_parse_refuses_wildcard():
    assert parse_cors_origins("*") == [_EXTENSION]
    assert parse_cors_origins("*, http://localhost:5173") == ["http://localhost:5173"]
