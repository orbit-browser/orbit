"""구글 로그인 라우터.

가입과 로그인이 한 엔드포인트다 — 처음 들어온 구글 계정이면 그 자리에서 사용자를
만들고(`is_new_user=true`), 이미 있으면 프로필만 갱신한다.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import User
from ..db.session import get_db
from ..schemas.auth import GoogleLoginRequest, LoginResponse, UserResponse
from ..services.auth_tokens import TokenError, issue_token
from ..services.google_auth import (
    GoogleAuthError,
    GoogleUnavailableError,
    verify_access_token,
)
from ..services.users import claim_legacy_data, get_or_create_user
from .deps import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


def _to_response(user: User) -> UserResponse:
    return UserResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        picture=user.picture,
        created_at=user.created_at,
        last_login_at=user.last_login_at,
    )


@router.post("/google", response_model=LoginResponse)
async def login_with_google(
    body: GoogleLoginRequest,
    db: AsyncSession = Depends(get_db),
) -> LoginResponse:
    """구글 access token 을 검증하고 우리 세션 토큰을 발급한다.

    최초 가입자에 한해 인증 도입 전 쌓인 `user_id="local"` 데이터를 넘겨받는다.
    """
    try:
        identity = await verify_access_token(body.access_token)
    except GoogleAuthError as err:
        # 클라이언트 토큰 문제 — 원문을 그대로 노출하지 않고 사유만 전달한다.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(err),
            headers={"WWW-Authenticate": "Bearer"},
        ) from err
    except GoogleUnavailableError as err:
        # 우리 잘못이 아니라 구글에 닿지 못한 것 — 재시도하면 될 수 있음을 알린다.
        logger.error("[auth] 구글 검증 불가: %s", err)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="구글 인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        ) from err

    user, is_new_user = await get_or_create_user(db, identity)
    claimed = await claim_legacy_data(db, user.id) if is_new_user else 0

    try:
        token, expires_at = issue_token(user.id)
    except TokenError as err:
        logger.error("[auth] 토큰 발급 실패: %s", err)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="세션 토큰을 발급하지 못했습니다",
        ) from err

    await db.commit()

    return LoginResponse(
        access_token=token,
        expires_at=expires_at,
        is_new_user=is_new_user,
        claimed_legacy_rows=claimed,
        user=_to_response(user),
    )


@router.get("/me", response_model=UserResponse)
async def read_me(user: User = Depends(get_current_user)) -> UserResponse:
    """현재 토큰의 사용자. 클라이언트가 세션 유효성을 확인하는 용도."""
    return _to_response(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(user: User = Depends(get_current_user)) -> None:
    """로그아웃.

    무상태 JWT라 서버가 폐기할 것은 없다 — 실제 무효화는 클라이언트가 토큰을 지우는 것이다.
    엔드포인트를 두는 이유는 (1) 클라이언트 흐름을 한 곳으로 모으고
    (2) 이후 토큰 폐기 목록을 도입할 때 자리를 미리 만들어 두기 위함이다.
    """
    logger.info("[auth] 로그아웃: user=%s", user.id)
