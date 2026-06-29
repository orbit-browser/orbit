import asyncio
import logging
from openai import AsyncOpenAI, RateLimitError, APIStatusError

from ..config import settings

logger = logging.getLogger(__name__)

_TIMEOUT = 60.0  # LLM 응답 최대 대기 시간 (초)


def _axk1_client() -> AsyncOpenAI:
    return AsyncOpenAI(
        api_key=settings.axk1_api_key,
        base_url=settings.axk1_base_url,
        timeout=_TIMEOUT,
    )


def _solar_client() -> AsyncOpenAI:
    return AsyncOpenAI(
        api_key=settings.upstage_api_key,
        base_url=settings.upstage_base_url,
        timeout=_TIMEOUT,
    )


async def chat_completion_light(
    system: str,
    user: str,
    *,
    temperature: float = 0.1,
    max_tokens: int = 500,
) -> str:
    """Solar Mini로 단순 분류/변환 태스크 처리. 실패 시 solar-pro3 fallback."""
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    client = _solar_client()
    try:
        resp = await client.chat.completions.create(
            model=settings.solar_mini_model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        if not resp.choices:
            raise ValueError("solar-mini 응답에 choices가 없습니다")
        return resp.choices[0].message.content or ""
    except Exception as exc:
        logger.warning("solar-mini 실패 (%s) — solar-pro3 fallback", exc)
        resp = await client.chat.completions.create(
            model=settings.solar_model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        if not resp.choices:
            raise ValueError("solar-pro3 fallback 응답에 choices가 없습니다")
        return resp.choices[0].message.content or ""


async def chat_completion(
    system: str,
    user: str,
    *,
    temperature: float = 0.3,
    max_tokens: int = 600,
) -> str:
    """A.X-K1 우선 호출, 429/5xx 시 solar-pro3 fallback."""
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
        return resp.choices[0].message.content or ""
    except RateLimitError:
        logger.warning("A.X-K1 RPS 초과 — 1초 후 solar-pro3 fallback")
        await asyncio.sleep(1)
    except APIStatusError as e:
        if e.status_code in (404, 503) or e.status_code >= 500:
            logger.warning("A.X-K1 %s 오류 — solar-pro3 fallback", e.status_code)
        else:
            raise

    client = _solar_client()
    resp = await client.chat.completions.create(
        model=settings.solar_model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return resp.choices[0].message.content or ""
