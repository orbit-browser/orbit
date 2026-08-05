"""Auto Session 세션화 파이프라인 평가 스크립트 (docs/evaluation-plan.md §3).

처리 흐름: 골든셋 로드 → event_filter로 정규화 → dedupe_events/group_by_time_gap(실
파이프라인과 동일한 순수 함수 재사용) → 그룹별 intent_analyzer.analyze() 호출(실 LLM 또는
기록 재생) → 지표 계산(eval/metrics.py) → 리포트 출력.

실행 (backend 디렉터리에서):
    python -m eval.run_eval
    python -m eval.run_eval --file eval/golden/rtx_5070_purchase.json
    python -m eval.run_eval --record eval/golden/_recorded.json
    python -m eval.run_eval --replay eval/golden/_recorded.json
"""

import argparse
import asyncio
import json
import logging
import sys
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit

from app.config import settings
from app.services import intent_analyzer
from app.services.event_filter import (
    content_hash as compute_content_hash,
    extract_search_query,
    is_system_url,
    normalize_url,
)
from app.services.grouper import dedupe_events, group_by_time_gap
from app.services.intent_analyzer import Assignment
from app.services.noise_filter import split_noise

from . import metrics

logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger(__name__)

_GOLDEN_DIR = Path(__file__).parent / "golden"
_GAP_MINUTES = 30
_MAX_GROUP_SIZE = 25


class LlmUnavailableError(RuntimeError):
    """실 LLM 모드에 필요한 API 키가 backend/.env에 없을 때(§4 실 LLM 모드 요구사항)."""


def _ensure_llm_credentials() -> None:
    if not settings.axk1_api_key and not settings.upstage_api_key:
        raise LlmUnavailableError(
            "AXK1_API_KEY/UPSTAGE_API_KEY가 backend/.env에 설정되어 있지 않습니다. "
            "실 LLM 모드로 run_eval을 실행하려면 최소 한 개의 키가 필요합니다. "
            "키 없이 지표 계산만 확인하려면 --replay <기록 파일>을 사용하세요."
        )


def _parse_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def load_scenario(path: Path) -> dict:
    """골든셋 JSON 파일 하나를 로드한다(evaluation-plan.md §2 포맷)."""
    return json.loads(path.read_text(encoding="utf-8"))


def build_pipeline_events(raw_events: list[dict]) -> list[dict]:
    """골든셋 이벤트(원시 ingest 입력 형태)를 실 인제스트 규칙으로 정규화한다.

    domain/normalized_url/search_query는 골든셋에 적혀 있어도 무시하고 event_filter로
    다시 계산한다 — "골든셋도 실 인제스트 규칙을 통과해야 한다"는 §3 원칙. 시스템 URL은
    인제스트 단계와 동일하게 걸러낸다.
    """
    events: list[dict] = []
    for e in raw_events:
        url = e["url"]
        if is_system_url(url):
            continue
        excerpt = e.get("content_excerpt") or ""
        events.append(
            {
                "id": e["id"],
                "url": url,
                "normalized_url": normalize_url(url),
                "title": e.get("title"),
                "domain": urlsplit(url).hostname,
                "search_query": extract_search_query(url),
                "visited_at": _parse_datetime(e["visited_at"]),
                "ended_at": None,
                "active_duration_ms": e.get("active_duration_ms"),
                "content_excerpt": excerpt,
                "content_hash": compute_content_hash(excerpt),
                "tab_id": None,
                "window_id": None,
                "event_type": "visit",
            }
        )
    return events


async def _analyze_group(
    group: list[dict],
    candidates: list[dict],
    call_key: str,
    *,
    record_sink: dict[str, dict] | None,
    replay_map: dict[str, dict] | None,
) -> list[Assignment]:
    """그룹 하나를 intent_analyzer.analyze로 분석한다(실 LLM/기록 재생 공용 경로).

    재생 모드든 기록 모드든 chat_completion_intent만 패치하고 analyze()의 파싱/방어
    로직은 그대로 실행한다 — 평가가 실제 코드 경로를 그대로 대표하게 하기 위함(§3, §4).
    """
    if replay_map is not None:
        recorded = replay_map.get(call_key)
        if recorded is None:
            raise KeyError(f"재생 파일에 '{call_key}' 호출 기록이 없습니다")

        async def _fake(*_args, **_kwargs) -> tuple[str, str]:
            return recorded["raw"], recorded["model"]

        with patch.object(intent_analyzer, "chat_completion_intent", _fake):
            return await intent_analyzer.analyze(group, candidates)

    if record_sink is None:
        return await intent_analyzer.analyze(group, candidates)

    original = intent_analyzer.chat_completion_intent

    async def _recording(*args, **kwargs) -> tuple[str, str]:
        raw, model = await original(*args, **kwargs)
        record_sink[call_key] = {"raw": raw, "model": model}
        return raw, model

    with patch.object(intent_analyzer, "chat_completion_intent", _recording):
        return await intent_analyzer.analyze(group, candidates)


async def evaluate_scenario(
    scenario: dict,
    *,
    record_sink: dict[str, dict] | None,
    replay_map: dict[str, dict] | None,
) -> tuple[list[metrics.EventOutcome], metrics.ScenarioDecision, list[dict]]:
    """골든셋 파일 하나를 처리해 (이벤트별 결과, new/existing 판단, 실패 케이스)를 반환한다."""
    name = scenario["name"]
    existing_sessions = scenario.get("existing_sessions", [])
    expected = scenario["expected"]

    events = build_pipeline_events(scenario["events"])
    kept, discarded_ids = dedupe_events(events)
    if discarded_ids:
        logger.warning(
            "%s: dedupe가 %d개 이벤트를 병합/제외했습니다 — 골든셋은 중복 URL이 없다고 가정합니다",
            name,
            len(discarded_ids),
        )

    groups = group_by_time_gap(kept, gap_minutes=_GAP_MINUTES, max_group_size=_MAX_GROUP_SIZE)

    predicted_key_by_event: dict[str, str | None] = {}
    actions_seen: list[str] = []
    create_counter = 0

    for group_index, group in enumerate(groups):
        # 노이즈 사전 필터 — 실 파이프라인(_process_group)과 동일하게 LLM 전에 적용한다.
        # 걸린 이벤트는 LLM 호출 없이 discard(noise)로 계상한다.
        group, prefilter_noise_ids = split_noise(group)
        for noise_id in prefilter_noise_ids:
            predicted_key_by_event[noise_id] = metrics.NOISE
        if not group:
            continue

        call_key = f"{name}::{group_index}"
        assignments = await _analyze_group(
            group, existing_sessions, call_key, record_sink=record_sink, replay_map=replay_map
        )

        for assignment in assignments:
            actions_seen.append(assignment.action)
            event_ids = [group[i]["id"] for i in assignment.event_indices if 0 <= i < len(group)]

            if assignment.action == "discard":
                key: str | None = metrics.NOISE
            elif assignment.action == "hold":
                key = None
            elif assignment.action == "append":
                key = f"{name}::{assignment.target}" if assignment.target else None
            elif assignment.action == "create":
                key = f"{name}::new::{create_counter}"
                create_counter += 1
            else:
                key = None

            for event_id in event_ids:
                predicted_key_by_event[event_id] = key

    outcomes: list[metrics.EventOutcome] = []
    for event_id, expected_label in expected["assignments"].items():
        expected_key = metrics.NOISE if expected_label == "noise" else f"{name}::{expected_label}"
        outcomes.append(
            metrics.EventOutcome(
                event_id=event_id,
                predicted_key=predicted_key_by_event.get(event_id),
                expected_key=expected_key,
            )
        )

    # 실패 케이스는 accuracy와 같은 기준(다수결 리매핑 후 비교)으로 골라야
    # "새 세션 생성" 정답도 오탐(false failure)으로 보고되지 않는다(metrics.py 모듈 docstring 참고).
    remapped = metrics.remap_predictions(outcomes)
    failures = [
        {
            "scenario": name,
            "event_id": outcome.event_id,
            "expected": expected["assignments"][outcome.event_id],
            "predicted_cluster": predicted_key_by_event.get(outcome.event_id),
            "predicted_after_remap": remapped_outcome.predicted_key,
        }
        for outcome, remapped_outcome in zip(outcomes, remapped)
        if remapped_outcome.predicted_key != remapped_outcome.expected_key
    ]

    decision = metrics.ScenarioDecision(
        scenario_name=name,
        expected=expected["new_vs_existing"],
        predicted=metrics.decide_new_vs_existing(actions_seen),
    )
    return outcomes, decision, failures


def _scenario_paths(file_arg: str | None) -> list[Path]:
    if file_arg:
        return [Path(file_arg)]
    return sorted(_GOLDEN_DIR.glob("*.json"))


async def run(args: argparse.Namespace) -> dict:
    replay_map: dict[str, dict] | None = None
    record_sink: dict[str, dict] | None = None

    if args.replay:
        replay_map = json.loads(Path(args.replay).read_text(encoding="utf-8"))
    else:
        _ensure_llm_credentials()
        if args.record:
            record_sink = {}

    all_outcomes: list[metrics.EventOutcome] = []
    all_decisions: list[metrics.ScenarioDecision] = []
    all_failures: list[dict] = []
    per_scenario: list[dict] = []

    for path in _scenario_paths(args.file):
        scenario = load_scenario(path)
        outcomes, decision, failures = await evaluate_scenario(
            scenario, record_sink=record_sink, replay_map=replay_map
        )
        all_outcomes.extend(outcomes)
        all_decisions.append(decision)
        all_failures.extend(failures)
        per_scenario.append(
            {
                "name": scenario["name"],
                "file": str(path),
                "assignment_accuracy": metrics.assignment_accuracy(outcomes),
                "session_purity": metrics.session_purity(outcomes),
                "session_coverage": metrics.session_coverage(outcomes),
                "noise_exclusion_rate": metrics.noise_exclusion_rate(outcomes),
                "new_vs_existing": {"expected": decision.expected, "predicted": decision.predicted},
            }
        )

    if record_sink is not None:
        Path(args.record).write_text(
            json.dumps(record_sink, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    return {
        "scenarios": per_scenario,
        "overall": {
            "assignment_accuracy": metrics.assignment_accuracy(all_outcomes),
            "session_purity": metrics.session_purity(all_outcomes),
            "session_coverage": metrics.session_coverage(all_outcomes),
            "noise_exclusion_rate": metrics.noise_exclusion_rate(all_outcomes),
            "new_vs_existing_accuracy": metrics.new_vs_existing_accuracy(all_decisions),
        },
        "failures": all_failures,
    }


def _format_pct(value: float | None) -> str:
    return "N/A" if value is None else f"{value * 100:.1f}%"


def _print_summary(report: dict) -> None:
    overall = report["overall"]
    print("=== Orbit 세션화 파이프라인 평가 결과 ===")
    print(f"Event-to-Session Assignment Accuracy: {_format_pct(overall['assignment_accuracy'])}")
    print(f"Session Purity:                       {_format_pct(overall['session_purity'])}")
    print(f"Session Coverage:                     {_format_pct(overall['session_coverage'])}")
    print(f"New-vs-Existing Decision Accuracy:     {_format_pct(overall['new_vs_existing_accuracy'])}")
    print(f"노이즈 제외율:                          {_format_pct(overall['noise_exclusion_rate'])}")
    print()
    print(f"시나리오 {len(report['scenarios'])}개, 실패 케이스 {len(report['failures'])}건")
    for failure in report["failures"]:
        print(
            f"  - [{failure['scenario']}] {failure['event_id']}: "
            f"기대={failure['expected']} 예측={failure['predicted_after_remap']}"
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Auto Session 세션화 파이프라인 평가")
    parser.add_argument("--file", help="골든셋 파일 하나만 평가(생략 시 backend/eval/golden/*.json 전체)")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--record", metavar="PATH", help="실 LLM 응답을 PATH에 기록")
    mode.add_argument("--replay", metavar="PATH", help="PATH에 기록된 응답을 재생(LLM 미호출)")
    args = parser.parse_args(argv)

    try:
        report = asyncio.run(run(args))
    except (LlmUnavailableError, FileNotFoundError, KeyError) as exc:
        print(f"오류: {exc}", file=sys.stderr)
        return 1

    _print_summary(report)
    print()
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
