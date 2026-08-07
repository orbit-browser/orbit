from datetime import datetime

from pydantic import BaseModel, Field


class GoogleLoginRequest(BaseModel):
    """익스텐션이 `chrome.identity.getAuthToken` 으로 받은 access token."""

    access_token: str = Field(min_length=1)


class UserResponse(BaseModel):
    id: str
    email: str
    name: str | None = None
    picture: str | None = None
    created_at: datetime
    last_login_at: datetime


class LoginResponse(BaseModel):
    """로그인 결과.

    `is_new_user` 로 클라이언트가 "가입 완료"와 "다시 오셨네요"를 구분한다.
    `claimed_legacy_rows` 는 최초 가입자에게 기존 로컬 데이터를 넘긴 행 수(보통 0).
    """

    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    is_new_user: bool
    claimed_legacy_rows: int = 0
    user: UserResponse
