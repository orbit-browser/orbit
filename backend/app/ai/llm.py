import asyncio
import logging
import time
from collections.abc import AsyncIterator
from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AsyncOpenAI,
    OpenAIError,
    RateLimitError,
)

from ..config import settings

logger = logging.getLogger(__name__)

# 폴링 UX 파이프라인이라 60초는 과함 — 짧게 잡아 fallback 진입을 앞당긴다
_TIMEOUT = 25.0  # LLM 응답 최대 대기 시간 (초)

# A.X 게이트웨이 3 RPS 대응(docs/target-architecture.md §5) — 스냅샷 경로와 배치 파이프라인이
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


def _ax_client() -> AsyncOpenAI:
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
    """감사 필드용 모델명 — A.X와 구분되도록 접두어를 붙인다."""
    return f"exaone/{settings.exaone_model}"


# EXAONE 4.0은 hybrid reasoning 모델 — thinking을 끄지 않으면 max_tokens를 추론 트레이스에
# 소모하고 message.content가 비어 온다(2026-08-05 실측). 분류/요약 용도에서는 항상 끈다.
_EXAONE_EXTRA_BODY = {"chat_template_kwargs": {"enable_thinking": False}}


# 다른 공급자로 넘겨 볼 만한 상태 코드. 401/403은 그 공급자의 키·모델 권한 문제라 다른 공급자는
# 정상일 수 있다(2026-10-19 A.X 키에 모델 권한이 없을 때 폴백 없이 Ask·요약이 전부 실패했다).
_FALLBACK_STATUS = (401, 403, 404, 429, 503)


def _should_fallback(status_code: int) -> bool:
    return status_code in _FALLBACK_STATUS or status_code >= 500


class StreamInterruptedError(RuntimeError):
    """첫 토큰 이후 provider 스트림이 끊겨 안전하게 fallback할 수 없는 상태."""

    def __init__(self, model: str):
        super().__init__(f"stream interrupted after output started ({model})")
        self.model = model


async def _stream_provider(
    client: AsyncOpenAI,
    *,
    model: str,
    messages: list[dict[str, str]],
    temperature: float,
    max_tokens: int,
    extra_body: dict | None = None,
) -> AsyncIterator[str]:
    stream = await client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        stream=True,
        **({"extra_body": extra_body} if extra_body else {}),
    )
    finish_reason = None
    try:
        async for chunk in stream:
            if not chunk.choices:
                continue
            finish_reason = chunk.choices[0].finish_reason or finish_reason
            text = chunk.choices[0].delta.content or ""
            if text:
                yield text
    finally:
        await stream.close()
    if finish_reason == "length":
        logger.warning("스트림 답변이 max_tokens(%s)에서 잘림 (model=%s)", max_tokens, model)


async def chat_completion_stream_with_meta(
    system: str,
    user: str,
    *,
    temperature: float = 0.2,
    max_tokens: int = 900,
) -> AsyncIterator[tuple[str, str]]:
    """A.X 스트리밍, 첫 토큰 전 실패 시 EXAONE fallback.

    일부 토큰을 이미 전송한 뒤 provider가 끊기면 다른 모델의 처음부터 다시 이어 붙일 수 없으므로
    `StreamInterruptedError`를 발생시켜 호출자가 partial 오류를 명시하게 한다.
    """
    await _throttle()
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]

    primary_model = settings.axk1_model
    yielded = False
    try:
        async for text in _stream_provider(
            _ax_client(),
            model=primary_model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        ):
            yielded = True
            yield text, primary_model
        if not yielded:
            raise ValueError("A.X 빈 스트림")
        return
    except asyncio.CancelledError:
        raise
    except APIStatusError as exc:
        if yielded:
            raise StreamInterruptedError(primary_model) from exc
        if not _should_fallback(exc.status_code):
            raise
        logger.warning("A.X 스트림 %s 오류 — EXAONE fallback", exc.status_code)
    except (RateLimitError, APIConnectionError, APITimeoutError, ValueError) as exc:
        if yielded:
            raise StreamInterruptedError(primary_model) from exc
        logger.warning("A.X 스트림 시작 실패 (%s) — EXAONE fallback", exc)
    except Exception as exc:
        if yielded:
            raise StreamInterruptedError(primary_model) from exc
        raise

    fallback_model = _exaone_model_label()
    fallback_yielded = False
    try:
        async for text in _stream_provider(
            _friendli_client(),
            model=settings.exaone_model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            extra_body=_EXAONE_EXTRA_BODY,
        ):
            fallback_yielded = True
            yield text, fallback_model
        if not fallback_yielded:
            raise ValueError("EXAONE 빈 스트림")
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        if fallback_yielded:
            raise StreamInterruptedError(fallback_model) from exc
        raise


async def chat_completion_light(
    system: str,
    user: str,
    *,
    temperature: float = 0.1,
    max_tokens: int = 500,
) -> str:
    """탭 묶기 같은 단순 분류/변환 태스크. A.X 우선, 실패 시 EXAONE fallback.

    모델 배정 근거: docs/DecisionLog.md 2026-10-22 (model-eval-v1 — 모든 LLM 역할 기본 A.X-K2).
    """
    await _throttle()
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    try:
        resp = await _ax_client().chat.completions.create(
            model=settings.axk1_model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        content = resp.choices[0].message.content if resp.choices else ""
        # 빈 응답을 돌려주면 cluster_tabs가 전체를 한 그룹으로 묶는다 — 의도 분석과 같은 기준으로 넘긴다.
        if not (content or "").strip():
            raise ValueError("A.X 빈 응답")
        return content
    except Exception as exc:
        logger.warning("A.X 실패 (%s) — EXAONE fallback", exc)
        resp = await _friendli_client().chat.completions.create(
            model=settings.exaone_model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            extra_body=_EXAONE_EXTRA_BODY,
        )
        if not resp.choices:
            raise ValueError("EXAONE fallback 응답에 choices가 없습니다")
        return resp.choices[0].message.content or ""


async def chat_completion_with_meta(
    system: str,
    user: str,
    *,
    temperature: float = 0.3,
    max_tokens: int = 600,
) -> tuple[str, str]:
    """A.X 우선 호출, 장애 시 EXAONE fallback. (content, 실제 사용된 model명)을 반환한다."""
    await _throttle()
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]

    try:
        client = _ax_client()
        resp = await client.chat.completions.create(
            model=settings.axk1_model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        if not resp.choices:
            raise ValueError("A.X 응답에 choices가 없습니다")
        return resp.choices[0].message.content or "", settings.axk1_model
    except RateLimitError:
        logger.warning("A.X RPS 초과 — 1초 후 EXAONE fallback")
        await asyncio.sleep(1)
    except APIStatusError as e:
        if _should_fallback(e.status_code):
            logger.warning("A.X %s 오류 — EXAONE fallback", e.status_code)
        else:
            raise
    except (APIConnectionError, APITimeoutError) as exc:
        # 상태 코드조차 못 받는 네트워크 레벨 장애 (DNS 실패, 연결 거부, 타임아웃) — 가장 흔한 장애 유형
        logger.warning("A.X 연결 실패 (%s) — EXAONE fallback", exc)

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
    """A.X 우선 호출, 장애 시 EXAONE fallback. (기존 호출부 무변경 유지를 위한 래퍼)"""
    content, _model = await chat_completion_with_meta(
        system, user, temperature=temperature, max_tokens=max_tokens
    )
    return content


# 의도분석 primary 시도 상한 — 게이트웨이가 429/지연이면 오래 기다리지 않고 EXAONE으로 넘긴다.
# max_retries=0으로 클라이언트 내부 백오프를 끊어(429가 즉시 예외로 올라오게) fallback을 앞당긴다.
_INTENT_PRIMARY_TIMEOUT = 12.0


async def chat_completion_intent(
    system: str,
    user: str,
    *,
    temperature: float = 0.0,
    max_tokens: int = 1000,
) -> tuple[str, str]:
    """의도분석 전용 — A.X 우선, 지연/rate limit/오류/빈 응답 시 EXAONE fallback. (content, model) 반환.

    근거: docs/DecisionLog.md 2026-10-22 model-eval-v1(R1 정확도 A.X-K2 87.6% 대 EXAONE 78.8%,
    JSON 유효율 100% 대 87.4%). chat_completion_with_meta와 달리 짧은 timeout·재시도 없음·빈 응답
    fallback을 둔다 — 세션화 배치에서 실패 한 번이 그룹 전체 hold로 이어지기 때문이다.
    """
    await _throttle()
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]

    try:
        client = AsyncOpenAI(
            api_key=settings.axk1_api_key,
            base_url=settings.axk1_base_url,
            timeout=_INTENT_PRIMARY_TIMEOUT,
            max_retries=0,
        )
        resp = await client.chat.completions.create(
            model=settings.axk1_model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        content = resp.choices[0].message.content if resp.choices else ""
        if not (content or "").strip():
            raise ValueError("A.X 빈 응답")
        return content, settings.axk1_model
    except RateLimitError:
        logger.warning("A.X rate limit — EXAONE fallback")
    except (APIConnectionError, APITimeoutError):
        logger.warning("A.X 지연/연결 실패 — EXAONE fallback")
    except APIStatusError as e:
        # 의도 분석은 401·403을 넘기지 않는다(품질 회의 2026-10-22-intent-k2). 키·모델 권한 오류를
        # EXAONE으로 가리면 세션화가 조용히 대체 모델로 돈다 — 올려서 그룹을 hold하고 설정을 고치게 한다.
        # 다른 경로(_should_fallback)는 origin #17대로 401·403도 넘긴다.
        if e.status_code in (404, 503) or e.status_code >= 500:
            logger.warning("A.X %s 오류 — EXAONE fallback", e.status_code)
        else:
            raise
    except ValueError as exc:
        logger.warning("A.X 응답 이상 (%s) — EXAONE fallback", exc)
    except OpenAIError as exc:
        # 클라이언트 생성 실패(AXK1_API_KEY 없음 등). 위의 상태·연결 오류는 이미 앞에서 걸렸다.
        logger.warning("A.X 클라이언트 오류 (%s) — EXAONE fallback", type(exc).__name__)

    resp = await _friendli_client().chat.completions.create(
        model=settings.exaone_model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        extra_body=_EXAONE_EXTRA_BODY,
    )
    if not resp.choices:
        raise ValueError("EXAONE fallback 응답에 choices가 없습니다")
    return resp.choices[0].message.content or "", _exaone_model_label()
