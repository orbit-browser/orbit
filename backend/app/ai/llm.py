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

# 공급자별 최소 호출 간격 리미터(docs/target-architecture.md §5). 스냅샷 경로와 배치 파이프라인이 공유하고,
# 공급자마다 asyncio.Lock으로 동시 호출을 직렬화한다. 예전 전역 0.5초 하나는 서로 다른 공급자까지 줄 세웠다.
# A.X-K2는 짧은 요청 6 RPS까지 429가 없어(eval/probe_rate_limit.py, company/meetings/2026-10-23-k2-rate.md)
# 여유를 두고 4 RPS로 둔다. EXAONE·KT는 한도를 재지 않아 A.X-K1 시절 값(0.5초)을 유지한다.
_MIN_CALL_INTERVAL = {"ax": 0.25, "exaone": 0.5, "kt": 0.5}  # 초
# 429를 받으면 그 공급자의 다음 호출만 이만큼 늦춘다. 다른 공급자로의 폴백 규칙은 그대로다.
_RATE_LIMIT_BACKOFF = 1.0  # 초
_rate_locks: dict[str, asyncio.Lock] = {}
_next_call_at: dict[str, float] = {}


async def _throttle(provider: str) -> None:
    """그 공급자의 다음 호출 시각까지 기다리고, 다음 시각을 최소 간격만큼 미룬다."""
    async with _rate_locks.setdefault(provider, asyncio.Lock()):
        wait = _next_call_at.get(provider, 0.0) - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        _next_call_at[provider] = time.monotonic() + _MIN_CALL_INTERVAL[provider]


def _back_off(provider: str) -> None:
    """429를 받은 공급자의 다음 호출을 늦춘다(이미 더 늦게 잡혀 있으면 그대로)."""
    _next_call_at[provider] = max(
        _next_call_at.get(provider, 0.0), time.monotonic() + _RATE_LIMIT_BACKOFF
    )


async def _create(provider: str, client: AsyncOpenAI, **kwargs):
    """공급자 리미터를 지나 chat completion 한 번. 429면 그 공급자만 늦추고 예외는 그대로 올린다."""
    await _throttle(provider)
    try:
        return await client.chat.completions.create(**kwargs)
    except RateLimitError:
        _back_off(provider)
        raise


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


def _kt_client() -> AsyncOpenAI:
    # 빈 키로 SDK가 내는 OPENAI_API_KEY 안내 대신 어떤 설정이 빠졌는지 남긴다.
    if not settings.kt_api_key:
        raise OpenAIError("KT_API_KEY is not set")
    return AsyncOpenAI(
        api_key=settings.kt_api_key,
        base_url=settings.kt_base_url,
        timeout=_TIMEOUT,
    )


def _exaone_model_label() -> str:
    """감사 필드용 모델명 — A.X와 구분되도록 접두어를 붙인다."""
    return f"exaone/{settings.exaone_model}"


def _kt_model_label() -> str:
    return f"kt/{settings.kt_model_name}"


async def _kt_completion(
    messages: list[dict[str, str]], *, temperature: float, max_tokens: int
) -> tuple[str, str]:
    """KT 믿:음 폴백 호출. (content, 모델 라벨)을 반환한다.

    KT는 추론 필드가 없어 extra_body를 넣지 않는다. 호출마다 숨은 입력 토큰이 약 590개 붙는다
    (model-eval-v1 연결 확인, 2026-10-23) — 비용 추정에 넣는다.
    """
    resp = await _create(
        "kt",
        _kt_client(),
        model=settings.kt_model_name,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    if not resp.choices:
        raise ValueError("KT fallback 응답에 choices가 없습니다")
    return resp.choices[0].message.content or "", _kt_model_label()


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
    """Ask 답변 스트리밍. K-EXAONE 우선, 첫 토큰 전 실패 시 A.X fallback.

    배정 근거: docs/DecisionLog.md 2026-10-23(R9 근거 일치 K2와 짝 차이 0, 첫 글자 p95 207ms 대 690ms).
    일부 토큰을 이미 전송한 뒤 provider가 끊기면 다른 모델의 처음부터 다시 이어 붙일 수 없으므로
    `StreamInterruptedError`를 발생시켜 호출자가 partial 오류를 명시하게 한다.
    """
    await _throttle("exaone")
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]

    primary_model = _exaone_model_label()
    yielded = False
    try:
        async for text in _stream_provider(
            _friendli_client(),
            model=settings.exaone_model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            extra_body=_EXAONE_EXTRA_BODY,
        ):
            yielded = True
            yield text, primary_model
        if not yielded:
            raise ValueError("EXAONE 빈 스트림")
        return
    except asyncio.CancelledError:
        raise
    except APIStatusError as exc:
        if exc.status_code == 429:
            _back_off("exaone")
        if yielded:
            raise StreamInterruptedError(primary_model) from exc
        if not _should_fallback(exc.status_code):
            raise
        logger.warning("EXAONE 스트림 %s 오류 — A.X fallback", exc.status_code)
    except (RateLimitError, APIConnectionError, APITimeoutError, ValueError) as exc:
        if yielded:
            raise StreamInterruptedError(primary_model) from exc
        logger.warning("EXAONE 스트림 시작 실패 (%s) — A.X fallback", exc)
    except OpenAIError as exc:
        if yielded:
            raise StreamInterruptedError(primary_model) from exc
        # 클라이언트 생성 실패(FRIENDLI_API_KEY 없음). 위의 상태·연결 오류는 이미 앞에서 걸렸다.
        logger.warning("EXAONE 클라이언트 오류 (%s) — A.X fallback", type(exc).__name__)
    except Exception as exc:
        if yielded:
            raise StreamInterruptedError(primary_model) from exc
        raise

    fallback_model = settings.axk1_model
    fallback_yielded = False
    await _throttle("ax")
    try:
        async for text in _stream_provider(
            _ax_client(),
            model=fallback_model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        ):
            fallback_yielded = True
            yield text, fallback_model
        if not fallback_yielded:
            raise ValueError("A.X 빈 스트림")
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        if isinstance(exc, RateLimitError):
            _back_off("ax")
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
    """탭 묶기 같은 단순 분류/변환 태스크. A.X 우선, 실패 시 KT fallback.

    모델 배정 근거: docs/DecisionLog.md 2026-10-23 (R10 K2 87.3%, KT 82.8%, EXAONE 78.9%).
    """
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    try:
        resp = await _create(
            "ax",
            _ax_client(),
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
        logger.warning("A.X 실패 (%s) — KT fallback", exc)
        content, _model = await _kt_completion(
            messages, temperature=temperature, max_tokens=max_tokens
        )
        return content


async def chat_completion_with_meta(
    system: str,
    user: str,
    *,
    temperature: float = 0.3,
    max_tokens: int = 600,
) -> tuple[str, str]:
    """A.X 우선 호출, 장애 시 EXAONE fallback. (content, 실제 사용된 model명)을 반환한다."""
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]

    try:
        resp = await _create(
            "ax",
            _ax_client(),
            model=settings.axk1_model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        if not resp.choices:
            raise ValueError("A.X 응답에 choices가 없습니다")
        return resp.choices[0].message.content or "", settings.axk1_model
    except RateLimitError:
        # _create가 A.X 다음 호출을 늦췄다. EXAONE은 따로 줄 서므로 바로 넘긴다.
        logger.warning("A.X RPS 초과 — EXAONE fallback")
    except APIStatusError as e:
        if _should_fallback(e.status_code):
            logger.warning("A.X %s 오류 — EXAONE fallback", e.status_code)
        else:
            raise
    except (APIConnectionError, APITimeoutError) as exc:
        # 상태 코드조차 못 받는 네트워크 레벨 장애 (DNS 실패, 연결 거부, 타임아웃) — 가장 흔한 장애 유형
        logger.warning("A.X 연결 실패 (%s) — EXAONE fallback", exc)

    resp = await _create(
        "exaone",
        _friendli_client(),
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


# 의도분석 primary 시도 상한 — 게이트웨이가 429/지연이면 오래 기다리지 않고 KT로 넘긴다.
# max_retries=0으로 클라이언트 내부 백오프를 끊어(429가 즉시 예외로 올라오게) fallback을 앞당긴다.
_INTENT_PRIMARY_TIMEOUT = 12.0


async def chat_completion_intent(
    system: str,
    user: str,
    *,
    temperature: float = 0.0,
    max_tokens: int = 1000,
) -> tuple[str, str]:
    """의도분석 전용 — A.X 우선, 지연/rate limit/오류/빈 응답 시 KT fallback. (content, model) 반환.

    근거: docs/DecisionLog.md 2026-10-23(R1 정확도 K2 87.6%·KT 88.3%·EXAONE 71.8%, JSON 유효율
    100%·100%·79.3% — EXAONE은 폴백으로도 안정성이 모자란다). chat_completion_with_meta와 달리 짧은
    timeout·재시도 없음·빈 응답 fallback을 둔다 — 세션화 배치에서 실패 한 번이 그룹 전체 hold로 이어지기 때문이다.
    KT 설정이 없으면 KT 호출이 OpenAIError로 실패하고, 호출자(analyze)가 그룹을 hold한다.
    """
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
        resp = await _create(
            "ax",
            client,
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
        logger.warning("A.X rate limit — KT fallback")
    except (APIConnectionError, APITimeoutError):
        logger.warning("A.X 지연/연결 실패 — KT fallback")
    except APIStatusError as e:
        # 의도 분석은 401·403을 넘기지 않는다(품질 회의 2026-10-22-intent-k2). 키·모델 권한 오류를
        # 대체 모델로 가리면 세션화가 조용히 대체 모델로 돈다 — 올려서 그룹을 hold하고 설정을 고치게 한다.
        # 다른 경로(_should_fallback)는 origin #17대로 401·403도 넘긴다.
        if e.status_code in (404, 503) or e.status_code >= 500:
            logger.warning("A.X %s 오류 — KT fallback", e.status_code)
        else:
            raise
    except ValueError as exc:
        logger.warning("A.X 응답 이상 (%s) — KT fallback", exc)
    except OpenAIError as exc:
        # 클라이언트 생성 실패(AXK1_API_KEY 없음 등). 위의 상태·연결 오류는 이미 앞에서 걸렸다.
        logger.warning("A.X 클라이언트 오류 (%s) — KT fallback", type(exc).__name__)

    return await _kt_completion(messages, temperature=temperature, max_tokens=max_tokens)


async def chat_completion_ax_only(
    system: str,
    user: str,
    *,
    temperature: float = 0.0,
    max_tokens: int = 400,
) -> tuple[str, str]:
    """A.X만 부른다(폴백 없음, 재시도 없음, 12초). 실패·빈 응답이면 예외를 올린다. (content, model) 반환.

    대상 나누기처럼 "못 하면 안 하는" 보조 판단용이다. 다른 모델로 넘기면 평가하지 않은 모델이 세션 경계를
    바꾸게 된다(S3 판정 2026-10-23: KT가 나누기를 맡으면 단일 주제 과분할이 1→5로 늘었다).
    """
    client = AsyncOpenAI(
        api_key=settings.axk1_api_key,
        base_url=settings.axk1_base_url,
        timeout=_INTENT_PRIMARY_TIMEOUT,
        max_retries=0,
    )
    resp = await _create(
        "ax",
        client,
        model=settings.axk1_model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        temperature=temperature,
        max_tokens=max_tokens,
    )
    content = resp.choices[0].message.content if resp.choices else ""
    if not (content or "").strip():
        raise ValueError("A.X 빈 응답")
    return content, settings.axk1_model
