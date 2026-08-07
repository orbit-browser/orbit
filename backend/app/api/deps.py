"""인증 의존성.

모든 데이터 라우터는 `Depends(get_current_user)` 를 통과해야 한다.
한 곳이라도 빠지면 그 경로로 남의 데이터가 노출된다.
"""

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import User
from ..db.session import get_db
from ..services.auth_tokens import TokenError, read_user_id

_UNAUTHORIZED_HEADERS = {"WWW-Authenticate": "Bearer"}


def _bearer_token(request: Request) -> str:
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="로그인이 필요합니다",
            headers=_UNAUTHORIZED_HEADERS,
        )
    return token.strip()


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> User:
    """Authorization 헤더의 토큰으로 사용자를 찾는다.

    토큰이 없거나 무효·만료면 401. 클라이언트가 재로그인을 유도할 수 있도록
    만료와 무효를 detail 문구로 구분한다(상태 코드는 동일).
    """
    token = _bearer_token(request)

    try:
        user_id = read_user_id(token)
    except TokenError as err:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(err),
            headers=_UNAUTHORIZED_HEADERS,
        ) from err

    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None:
        # 서명은 유효하지만 계정이 사라진 경우(탈퇴 등). 토큰을 신뢰하지 않는다.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="계정을 찾을 수 없습니다",
            headers=_UNAUTHORIZED_HEADERS,
        )
    return user


async def current_user_id(user: User = Depends(get_current_user)) -> str:
    """`user_id` 만 필요한 라우터용 축약 의존성."""
    return user.id
