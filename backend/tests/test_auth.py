"""인증 경계 테스트.

가장 중요한 것은 **실패 경로가 성공으로 새지 않는지**다 —
aud 불일치, 만료, 위조 서명이 통과하면 나머지 기능은 의미가 없다.
"""

import asyncio
from datetime import datetime, timedelta, timezone

import jwt
import pytest

from app.config import settings
from app.services import auth_tokens, google_auth
from app.services.auth_tokens import TokenError, issue_token, read_user_id
from app.services.google_auth import (
    GoogleAuthError,
    GoogleUnavailableError,
    verify_access_token,
)

_CLIENT_ID = "client-abc.apps.googleusercontent.com"


@pytest.fixture(autouse=True)
def _auth_settings(monkeypatch):
    monkeypatch.setattr(settings, "google_client_id", _CLIENT_ID)
    monkeypatch.setattr(settings, "jwt_secret", "test-secret")
    monkeypatch.setattr(settings, "jwt_expire_days", 30)


def _fake_fetch(responses):
    """`_fetch_json` 대역 — URL 별로 미리 준비한 응답(또는 예외)을 돌려준다."""

    async def fetch(url, *, params=None, headers=None):
        result = responses[url]
        if isinstance(result, Exception):
            raise result
        return result

    return fetch


# ── 구글 토큰 검증 ──────────────────────────────────────────────


def test_verify_returns_identity_when_audience_matches(monkeypatch):
    monkeypatch.setattr(
        google_auth,
        "_fetch_json",
        _fake_fetch(
            {
                google_auth._TOKENINFO_URL: {"aud": _CLIENT_ID, "sub": "g-1", "email": "a@b.com"},
                google_auth._USERINFO_URL: {"name": "홍길동", "picture": "https://p/x.png"},
            }
        ),
    )

    identity = asyncio.run(verify_access_token("tok"))

    assert identity.sub == "g-1"
    assert identity.email == "a@b.com"
    assert identity.name == "홍길동"


def test_verify_rejects_token_issued_to_another_client(monkeypatch):
    """다른 앱의 토큰으로 로그인되면 안 된다(confused deputy) — 이 테스트가 핵심 방어선이다."""
    monkeypatch.setattr(
        google_auth,
        "_fetch_json",
        _fake_fetch(
            {
                google_auth._TOKENINFO_URL: {
                    "aud": "someone-else.apps.googleusercontent.com",
                    "sub": "g-1",
                    "email": "a@b.com",
                }
            }
        ),
    )

    with pytest.raises(GoogleAuthError):
        asyncio.run(verify_access_token("tok"))


def test_verify_rejects_when_tokeninfo_reports_error(monkeypatch):
    monkeypatch.setattr(
        google_auth,
        "_fetch_json",
        _fake_fetch({google_auth._TOKENINFO_URL: {"error": "invalid_token"}}),
    )

    with pytest.raises(GoogleAuthError):
        asyncio.run(verify_access_token("tok"))


def test_verify_rejects_when_email_scope_missing(monkeypatch):
    monkeypatch.setattr(
        google_auth,
        "_fetch_json",
        _fake_fetch({google_auth._TOKENINFO_URL: {"aud": _CLIENT_ID, "sub": "g-1"}}),
    )

    with pytest.raises(GoogleAuthError):
        asyncio.run(verify_access_token("tok"))


def test_verify_rejects_empty_token():
    with pytest.raises(GoogleAuthError):
        asyncio.run(verify_access_token(""))


def test_verify_rejects_when_server_client_id_missing(monkeypatch):
    """설정 누락을 인증 성공으로 넘기면 누구나 로그인할 수 있게 된다."""
    monkeypatch.setattr(settings, "google_client_id", "")

    with pytest.raises(GoogleAuthError):
        asyncio.run(verify_access_token("tok"))


def test_verify_surfaces_google_outage_separately(monkeypatch):
    """구글에 닿지 못한 것은 토큰이 잘못된 것과 구분한다(503 vs 401)."""
    monkeypatch.setattr(
        google_auth,
        "_fetch_json",
        _fake_fetch({google_auth._TOKENINFO_URL: GoogleUnavailableError("timeout")}),
    )

    with pytest.raises(GoogleUnavailableError):
        asyncio.run(verify_access_token("tok"))


def test_profile_failure_does_not_block_login(monkeypatch):
    """이름·사진은 부가 정보다 — 못 가져와도 로그인 자체는 되어야 한다."""
    monkeypatch.setattr(
        google_auth,
        "_fetch_json",
        _fake_fetch(
            {
                google_auth._TOKENINFO_URL: {"aud": _CLIENT_ID, "sub": "g-1", "email": "a@b.com"},
                google_auth._USERINFO_URL: GoogleUnavailableError("down"),
            }
        ),
    )

    identity = asyncio.run(verify_access_token("tok"))

    assert identity.sub == "g-1"
    assert identity.name is None
    assert identity.picture is None


# ── 세션 토큰 ──────────────────────────────────────────────


def test_issue_then_read_roundtrip():
    token, expires_at = issue_token("user-1")
    assert read_user_id(token) == "user-1"
    assert expires_at > datetime.now(timezone.utc)


def test_read_rejects_expired_token():
    payload = {
        "sub": "user-1",
        "iss": auth_tokens._ISSUER,
        "iat": datetime.now(timezone.utc) - timedelta(days=2),
        "exp": datetime.now(timezone.utc) - timedelta(days=1),
    }
    expired = jwt.encode(payload, settings.jwt_secret, algorithm="HS256")

    with pytest.raises(TokenError):
        read_user_id(expired)


def test_read_rejects_token_signed_with_wrong_secret():
    payload = {
        "sub": "user-1",
        "iss": auth_tokens._ISSUER,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(days=1),
    }
    forged = jwt.encode(payload, "wrong-secret", algorithm="HS256")

    with pytest.raises(TokenError):
        read_user_id(forged)


def test_read_rejects_token_from_another_issuer():
    payload = {
        "sub": "user-1",
        "iss": "not-orbit",
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(days=1),
    }
    other = jwt.encode(payload, settings.jwt_secret, algorithm="HS256")

    with pytest.raises(TokenError):
        read_user_id(other)


def test_read_rejects_unsigned_token():
    """alg=none 우회를 막는다 — 알고리즘 목록을 HS256으로 고정했기 때문에 통과하면 안 된다."""
    unsigned = jwt.encode(
        {
            "sub": "user-1",
            "iss": auth_tokens._ISSUER,
            "exp": datetime.now(timezone.utc) + timedelta(days=1),
        },
        key="",
        algorithm="none",
    )

    with pytest.raises(TokenError):
        read_user_id(unsigned)


def test_read_rejects_empty_and_garbage():
    for bad in ["", "not-a-jwt", "a.b.c"]:
        with pytest.raises(TokenError):
            read_user_id(bad)


def test_token_operations_fail_when_secret_missing(monkeypatch):
    monkeypatch.setattr(settings, "jwt_secret", "")

    with pytest.raises(TokenError):
        issue_token("user-1")
    with pytest.raises(TokenError):
        read_user_id("anything")
