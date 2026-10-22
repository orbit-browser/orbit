"""A.X 게이트웨이(AXK1_* 설정, 기본 A.X-K2) 호출 한도 탐침 — 유료, 최대 200회.

    python -m eval.probe_rate_limit --out rate.jsonl          # 계획만 출력
    python -m eval.probe_rate_limit --out rate.jsonl --yes    # 실제 호출

아주 짧은 요청(max_tokens 8)을 1→2→3→4→6 RPS로 단계마다 10초씩 보낸다. 요청은 정해진 시각에 출발시키고
(앞 응답을 기다리지 않음) 응답을 기다리는 동안 다음 요청이 나간다. 첫 429가 나오거나 한 단계의 오류율이 20%를
넘으면 남은 요청을 취소하고 멈춘다. 재시도·폴백·제품 throttle은 거치지 않는다(max_retries=0).
출력은 상태 코드, 지연, 한도 관련 응답 헤더(이름·값)뿐이다. 키는 클라이언트에만 넘기고 출력하지 않는다.
"""

import argparse
import asyncio
import json
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Awaitable, Callable

STAGES_RPS = [1, 2, 3, 4, 6]
STAGE_SECONDS = 10
MAX_CALLS = 200
ERROR_RATE_STOP = 0.2
_LIMIT_HEADER_PREFIXES = ("x-ratelimit", "ratelimit", "retry-after", "x-rate-limit")


@dataclass
class Result:
    stage_rps: int
    status: int | None  # None = 연결·타임아웃 오류
    latency_ms: float
    error: str | None = None
    limit_headers: dict[str, str] = field(default_factory=dict)


Caller = Callable[[], Awaitable[tuple[int | None, dict[str, str], str | None]]]


def limit_headers(headers: dict[str, str]) -> dict[str, str]:
    """한도 관련 헤더만 남긴다(인증·쿠키 등은 버린다)."""
    return {k.lower(): v for k, v in headers.items() if k.lower().startswith(_LIMIT_HEADER_PREFIXES)}


def planned_calls(stages: list[int] = STAGES_RPS, seconds: int = STAGE_SECONDS) -> int:
    return sum(rps * seconds for rps in stages)


def percentile(values: list[float], pct: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    pos = (len(ordered) - 1) * pct / 100
    low, high = int(pos), min(int(pos) + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (pos - low)


def stage_summary(results: list[Result]) -> list[dict]:
    rows = []
    for rps in dict.fromkeys(r.stage_rps for r in results):
        stage = [r for r in results if r.stage_rps == rps]
        ok = [r.latency_ms for r in stage if r.status == 200]
        rows.append({
            "rps": rps, "sent": len(stage), "ok": len(ok),
            "http_429": sum(1 for r in stage if r.status == 429),
            "other_error": sum(1 for r in stage if r.status not in (200, 429)),
            "p50_ms": percentile(ok, 50), "p95_ms": percentile(ok, 95),
        })
    return rows


async def run_stages(caller: Caller, stages: list[int] = STAGES_RPS, seconds: float = STAGE_SECONDS,
                     clock: Callable[[], float] = time.perf_counter) -> tuple[list[Result], str]:
    """단계마다 rps×seconds개 요청을 정시에 출발시킨다. 반환: (결과, 멈춘 이유)."""
    results: list[Result] = []
    for rps in stages:
        stop = asyncio.Event()
        stage_results: list[Result] = []

        async def one(delay: float) -> None:
            await asyncio.sleep(delay)
            if stop.is_set():
                return
            start = clock()
            status, headers, error = await caller()
            result = Result(rps, status, (clock() - start) * 1000, error, limit_headers(headers))
            stage_results.append(result)
            if status == 429:
                stop.set()

        tasks = [asyncio.create_task(one(i / rps)) for i in range(int(rps * seconds))]
        await asyncio.gather(*tasks)
        results += stage_results
        if any(r.status == 429 for r in stage_results):
            return results, f"429 at {rps} RPS"
        errors = sum(1 for r in stage_results if r.status != 200)
        if stage_results and errors / len(stage_results) > ERROR_RATE_STOP:
            return results, f"error rate {errors}/{len(stage_results)} at {rps} RPS"
    return results, "all stages passed"


def _ax_caller() -> Caller:
    from openai import APIConnectionError, APIStatusError, APITimeoutError, AsyncOpenAI

    from app.config import settings

    if not settings.axk1_api_key:
        raise SystemExit("error: AXK1_API_KEY is not set")
    client = AsyncOpenAI(api_key=settings.axk1_api_key, base_url=settings.axk1_base_url, timeout=15.0, max_retries=0)

    async def call() -> tuple[int | None, dict[str, str], str | None]:
        try:
            raw = await client.chat.completions.with_raw_response.create(
                model=settings.axk1_model, messages=[{"role": "user", "content": "ok"}], max_tokens=8, temperature=0,
            )
            return raw.http_response.status_code, dict(raw.headers), None
        except APIStatusError as exc:
            return exc.status_code, dict(exc.response.headers), f"http_{exc.status_code}"
        except APITimeoutError:
            return None, {}, "timeout"
        except APIConnectionError:
            return None, {}, "connection"

    return call


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Probe the A.X gateway rate limit (paid, <=200 calls)")
    parser.add_argument("--out", required=True, help="jsonl file for per-call results")
    parser.add_argument("--yes", action="store_true", help="actually call the API")
    args = parser.parse_args(argv)
    planned = planned_calls()
    print(f"stages {STAGES_RPS} RPS x {STAGE_SECONDS}s -> at most {planned} calls (cap {MAX_CALLS})")
    if planned > MAX_CALLS:
        print("error: plan exceeds cap", file=sys.stderr)
        return 3
    if not args.yes:
        print("dry run: add --yes to call the API")
        return 0
    from app.config import settings

    results, reason = asyncio.run(run_stages(_ax_caller()))
    Path(args.out).write_text("".join(json.dumps(asdict(r), ensure_ascii=False) + "\n" for r in results), encoding="utf-8")
    print(f"model {settings.axk1_model}; stopped: {reason}; calls {len(results)}")
    for row in stage_summary(results):
        print(json.dumps(row))
    names = sorted({k for r in results for k in r.limit_headers})
    for name in names:
        values = sorted({r.limit_headers[name] for r in results if name in r.limit_headers})
        print(f"header {name}: {values[:5]}")
    if not names:
        print("header: no rate-limit headers in responses")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
