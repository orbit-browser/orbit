"""구글 access token 검증.

익스텐션은 `chrome.identity.getAuthToken` 으로 **access token**(ID 토큰이 아니다)을 받아
백엔드에 보낸다. 백엔드는 그 토큰이

  1. 유효하고 (만료되지 않았고)
  2. **우리 OAuth 클라이언트에 발급된 것인지** (`aud == google_client_id`)

를 구글에 물어 확인한다. 2번을 빼면 다른 앱용으로 발급된 토큰으로도 우리 서비스에
로그인할 수 있다(confused deputy). 이 모듈에서 가장 중요한 검사다.

외부 호출이므로 타임아웃과 제한된 재시도를 둔다(AGENTS.md §10).
검증 실패는 절대 성공으로 흘려보내지 않는다 — fallback 없음(§11).
"""

import asyncio
import logging
from dataclasses import dataclass

import httpx

from ..config import settings

logger = logging.getLogger(__name__)

_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"
_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"

_TIMEOUT = httpx.Timeout(5.0)
_RETRIES = 2  # 네트워크 순간 오류만 흡수. 검증 실패는 재시도하지 않는다.


class GoogleAuthError(Exception):
    """검증 실패 — 클라이언트 잘못(401로 응답)."""


class GoogleUnavailableError(Exception):
    """구글에 물어보지 못함 — 우리 잘못도 클라이언트 잘못도 아님(503으로 응답)."""


@dataclass(frozen=True)
class GoogleIdentity:
    sub: str
    email: str
    name: str | None = None
    picture: str | None = None


async def verify_access_token(access_token: str) -> GoogleIdentity:
    """access token 을 검증하고 구글 계정 정보를 돌려준다.

    Raises:
        GoogleAuthError: 토큰이 무효·만료됐거나 우리 클라이언트 것이 아닐 때.
        GoogleUnavailableError: 구글 응답을 받지 못했을 때.
    """
    if not access_token:
        raise GoogleAuthError("access token이 비어 있습니다")
    if not settings.google_client_id:
        # 설정 누락을 인증 성공으로 넘기면 누구나 로그인할 수 있게 된다.
        raise GoogleAuthError("서버에 google_client_id가 설정되지 않았습니다")

    info = await _fetch_json(_TOKENINFO_URL, params={"access_token": access_token})

    # tokeninfo 는 무효 토큰에 대해 200 + error 필드로 답할 때가 있다.
    if "error" in info or "error_description" in info:
        raise GoogleAuthError("유효하지 않은 access token입니다")

    audience = info.get("aud")
    if audience != settings.google_client_id:
        # 다른 앱에서 발급된 토큰. 절대 통과시키지 않는다.
        logger.warning("[auth] aud 불일치 — 예상=%s 실제=%s", settings.google_client_id, audience)
        raise GoogleAuthError("이 애플리케이션에 발급된 토큰이 아닙니다")

    sub = info.get("sub")
    if not sub:
        raise GoogleAuthError("토큰에 계정 식별자(sub)가 없습니다")

    email = info.get("email")
    if not email:
        raise GoogleAuthError("이메일 범위가 승인되지 않았습니다")

    # 프로필(이름·사진)은 부가 정보다. 실패해도 로그인 자체는 막지 않는다.
    name, picture = await _fetch_profile(access_token)
    return GoogleIdentity(sub=sub, email=email, name=name, picture=picture)


async def _fetch_profile(access_token: str) -> tuple[str | None, str | None]:
    try:
        profile = await _fetch_json(
            _USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"}
        )
    except (GoogleAuthError, GoogleUnavailableError) as err:
        logger.info("[auth] 프로필 조회 실패 — 로그인은 계속 진행합니다: %s", err)
        return None, None
    return profile.get("name"), profile.get("picture")


async def _fetch_json(
    url: str,
    *,
    params: dict[str, str] | None = None,
    headers: dict[str, str] | None = None,
) -> dict:
    last_error: Exception | None = None

    for attempt in range(_RETRIES + 1):
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                response = await client.get(url, params=params, headers=headers)
        except httpx.HTTPError as err:  # 네트워크·타임아웃 — 재시도 대상
            last_error = err
            if attempt < _RETRIES:
                await asyncio.sleep(0.2 * (attempt + 1))
                continue
            raise GoogleUnavailableError(f"구글에 연결하지 못했습니다: {err}") from err

        if response.status_code == 400 or response.status_code == 401:
            # 토큰이 잘못된 것 — 재시도해도 같다.
            raise GoogleAuthError("유효하지 않은 access token입니다")
        if response.status_code >= 500:
            last_error = GoogleUnavailableError(f"구글 응답 {response.status_code}")
            if attempt < _RETRIES:
                await asyncio.sleep(0.2 * (attempt + 1))
                continue
            raise last_error
        if response.status_code != 200:
            raise GoogleAuthError(f"예상하지 못한 구글 응답: {response.status_code}")

        try:
            payload = response.json()
        except ValueError as err:
            raise GoogleUnavailableError("구글 응답을 해석하지 못했습니다") from err
        if not isinstance(payload, dict):
            raise GoogleUnavailableError("구글 응답 형식이 올바르지 않습니다")
        return payload

    raise GoogleUnavailableError(f"구글에 연결하지 못했습니다: {last_error}")
