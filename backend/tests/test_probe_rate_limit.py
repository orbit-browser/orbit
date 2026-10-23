"""A.X 한도 탐침 대역 시험 — 네트워크 0. 단계 진행과 멈춤 조건, 헤더 거르기를 본다."""

import asyncio

from eval import probe_rate_limit as probe


def test_plan_stays_under_cap():
    assert probe.planned_calls() == 10 + 20 + 30 + 40 + 60 == 160 <= probe.MAX_CALLS


def test_only_rate_limit_headers_are_kept():
    kept = probe.limit_headers({"X-RateLimit-Limit": "3", "Retry-After": "1", "Authorization": "Bearer k", "Set-Cookie": "s"})
    assert kept == {"x-ratelimit-limit": "3", "retry-after": "1"}


def test_stops_at_first_429_stage_and_skips_later_stages():
    calls = {"n": 0}

    async def fake() -> tuple[int | None, dict[str, str], str | None]:
        calls["n"] += 1
        # 1 RPS 단계(2회) 통과, 2 RPS 단계의 두 번째 호출에서 429
        return (429, {"Retry-After": "1"}, "http_429") if calls["n"] == 4 else (200, {}, None)

    results, reason = asyncio.run(probe.run_stages(fake, stages=[1, 2, 3], seconds=2))
    assert reason == "429 at 2 RPS"
    assert {r.stage_rps for r in results} == {1, 2}  # 3 RPS 단계는 보내지 않음
    rows = probe.stage_summary(results)
    assert rows[0] == {"rps": 1, "sent": 2, "ok": 2, "http_429": 0, "other_error": 0,
                       "p50_ms": rows[0]["p50_ms"], "p95_ms": rows[0]["p95_ms"]}
    assert rows[1]["http_429"] == 1 and rows[1]["sent"] < 4  # 429 뒤 남은 요청은 취소


def test_error_rate_over_20_percent_stops():
    async def flaky() -> tuple[int | None, dict[str, str], str | None]:
        return None, {}, "timeout"

    results, reason = asyncio.run(probe.run_stages(flaky, stages=[1, 2], seconds=1))
    assert reason == "error rate 1/1 at 1 RPS" and len(results) == 1


def test_percentile_linear():
    assert probe.percentile([4, 1, 3, 2], 50) == 2.5 and probe.percentile([], 50) is None
