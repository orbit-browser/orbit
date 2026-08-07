"""자체 세션 토큰(JWT) 발급·검증.

구글 토큰은 로그인 시 1회만 검증하고(`google_auth`), 이후 요청은 여기서 발급한
토큰으로 인증한다. 만료 정책을 우리가 통제하고 매 요청마다 구글에 묻지 않기 위해서다.

알고리즘을 HS256으로 고정한다 — 토큰의 `alg` 헤더를 그대로 믿으면
`alg: none` 이나 비대칭키 혼동으로 서명 검증을 우회당할 수 있다.
"""

from datetime import datetime, timedelta, timezone

import jwt

from ..config import settings

_ALGORITHM = "HS256"
_ISSUER = "orbit"


class TokenError(Exception):
    """토큰이 없거나 무효·만료됨."""


def issue_token(user_id: str) -> tuple[str, datetime]:
    """사용자 세션 토큰을 발급하고 (토큰, 만료시각)을 돌려준다."""
    if not settings.jwt_secret:
        raise TokenError("서버에 jwt_secret이 설정되지 않았습니다")

    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.jwt_expire_days)
    payload = {
        "sub": user_id,
        "iss": _ISSUER,
        "iat": datetime.now(timezone.utc),
        "exp": expires_at,
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm=_ALGORITHM)
    return token, expires_at


def read_user_id(token: str) -> str:
    """토큰에서 사용자 id를 꺼낸다. 검증 실패는 예외로만 알린다.

    Raises:
        TokenError: 서명 불일치, 만료, 발급자 불일치, 형식 오류.
    """
    if not settings.jwt_secret:
        raise TokenError("서버에 jwt_secret이 설정되지 않았습니다")
    if not token:
        raise TokenError("토큰이 없습니다")

    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[_ALGORITHM],  # 목록 고정 — alg 혼동 방어
            issuer=_ISSUER,
            options={"require": ["sub", "exp", "iss"]},
        )
    except jwt.ExpiredSignatureError as err:
        raise TokenError("토큰이 만료되었습니다") from err
    except jwt.InvalidTokenError as err:
        raise TokenError("유효하지 않은 토큰입니다") from err

    user_id = payload.get("sub")
    if not isinstance(user_id, str) or not user_id:
        raise TokenError("토큰에 사용자 식별자가 없습니다")
    return user_id
