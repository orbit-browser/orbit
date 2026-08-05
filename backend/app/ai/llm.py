import asyncio
import logging
import time
from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AsyncOpenAI,
    RateLimitError,
)

from ..config import settings

logger = logging.getLogger(__name__)

# 폴링 UX 파이프라인이라 60초는 과함 — 짧게 잡아 fallback 진입을 앞당긴다
_TIMEOUT = 25.0  # LLM 응답 최대 대기 시간 (초)

# A.X-K1 3 RPS 대응(docs/target-architecture.md §5) — 스냅샷 경로와 배치 파이프라인이
# 공유하는 전역 최소 호출 간격 리미터. asyncio.Lock으로 감싸 동시 호출도 직렬화한다.
_MIN_CALL_INTERVAL = 0.5  # 초
_rate_lock = asyncio.Lock()
_last_call_at: float = 0.0


async def _throttle() -> None:
    """직전 chat 호출 이후 최소 간격이 지날 때까지 대기한다."""
    global _last_call_at
    async with _rate_lock:
        elapsed = time.monotonic() - _last_call_at
        if elapsed < _MIN_CALL_INTERVAL:
            await asyncio.sleep(_MIN_CALL_INTERVAL - elapsed)
        _last_call_at = time.monotonic()


def _axk1_client() -> AsyncOpenAI:
    return AsyncOpenAI(
        api_key=settings.axk1_api_key,
        base_url=settings.axk1_base_url,
        timeout=_TIMEOUT,
    )


def _friendli_client() -> AsyncOpenAI:
    return AsyncOpenAI(
        api_key=settings.friendli_api_key,
        base_url=settings.friendli_base_url,
        timeout=_TIMEOUT,
    )


def _exaone_model_label() -> str:
    """감사 필드용 모델명 — dedicated endpoint ID는 불투명하므로 접두어를 붙인다."""
    return f"exaone/{settings.exaone_model}"


# EXAONE 4.0은 hybrid reasoning 모델 — thinking을 끄지 않으면 max_tokens를 추론 트레이스에
# 소모하고 message.content가 비어 온다(2026-08-05 실측). 분류/요약 용도에서는 항상 끈다.
_EXAONE_EXTRA_BODY = {"chat_template_kwargs": {"enable_thinking": False}}


async def chat_completion_light(
    system: str,
    user: str,
    *,
    temperature: float = 0.1,
    max_tokens: int = 500,
) -> str:
    """EXAONE(FriendliAI)으로 단순 분류/변환 태스크 처리. 실패 시 A.X-K1 fallback.

    모델 배정 근거: docs/DecisionLog.md 2026-08-05 (클러스터링=EXAONE, 상호 폴백).
    """
    await _throttle()
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    try:
        resp = await _friendli_client().chat.completions.create(
            model=settings.exaone_model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            extra_body=_EXAONE_EXTRA_BODY,
        )
        if not resp.choices:
            raise ValueError("EXAONE 응답에 choices가 없습니다")
        return resp.choices[0].message.content or ""
    except Exception as exc:
        logger.warning("EXAONE 실패 (%s) — A.X-K1 fallback", exc)
        resp = await _axk1_client().chat.completions.create(
            model=settings.axk1_model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        if not resp.choices:
            raise ValueError("A.X-K1 fallback 응답에 choices가 없습니다")
        return resp.choices[0].message.content or ""


async def chat_completion_with_meta(
    system: str,
    user: str,
    *,
    temperature: float = 0.3,
    max_tokens: int = 600,
) -> tuple[str, str]:
    """A.X-K1 우선 호출, 장애 시 EXAONE fallback. (content, 실제 사용된 model명)을 반환한다."""
    await _throttle()
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]

    try:
        client = _axk1_client()
        resp = await client.chat.completions.create(
            model=settings.axk1_model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        if not resp.choices:
            raise ValueError("A.X-K1 응답에 choices가 없습니다")
        return resp.choices[0].message.content or "", settings.axk1_model
    except RateLimitError:
        logger.warning("A.X-K1 RPS 초과 — 1초 후 EXAONE fallback")
        await asyncio.sleep(1)
    except APIStatusError as e:
        if e.status_code in (404, 503) or e.status_code >= 500:
            logger.warning("A.X-K1 %s 오류 — EXAONE fallback", e.status_code)
        else:
            raise
    except (APIConnectionError, APITimeoutError) as exc:
        # 상태 코드조차 못 받는 네트워크 레벨 장애 (DNS 실패, 연결 거부, 타임아웃) — 가장 흔한 장애 유형
        logger.warning("A.X-K1 연결 실패 (%s) — EXAONE fallback", exc)

    resp = await _friendli_client().chat.completions.create(
        model=settings.exaone_model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        extra_body=_EXAONE_EXTRA_BODY,
    )
    return resp.choices[0].message.content or "", _exaone_model_label()


async def chat_completion(
    system: str,
    user: str,
    *,
    temperature: float = 0.3,
    max_tokens: int = 600,
) -> str:
    """A.X-K1 우선 호출, 장애 시 EXAONE fallback. (기존 호출부 무변경 유지를 위한 래퍼)"""
    content, _model = await chat_completion_with_meta(
        system, user, temperature=temperature, max_tokens=max_tokens
    )
    return content
