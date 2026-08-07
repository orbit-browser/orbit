"""자연어 열린 탭 resolver 실제 임베딩 평가.

실행하면 Upstage API를 실제 호출하므로 비용이 발생한다.
사용자가 명시적으로 요청한 경우에만 실행한다.
"""

import asyncio
import json
import sys
from pathlib import Path

from app.ai.embedding import embed_many
from app.config import settings
from app.schemas.tab_action import OpenTabCandidate
from app.services import tab_action_resolver as resolver

_GOLDEN_PATH = Path(__file__).parent / "tab_action_cases.json"


def _metrics(cases: list[dict], predicted_tab_ids: list[str | None]) -> dict[str, float | int]:
    positives = [index for index, case in enumerate(cases) if case["expected_tab_id"] is not None]
    negatives = [index for index, case in enumerate(cases) if case["expected_tab_id"] is None]
    positive_correct = sum(
        predicted_tab_ids[index] == cases[index]["expected_tab_id"]
        for index in positives
    )
    negative_correct = sum(predicted_tab_ids[index] is None for index in negatives)
    return {
        "positive_correct": positive_correct,
        "positive_total": len(positives),
        "negative_correct": negative_correct,
        "negative_total": len(negatives),
        "total_correct": positive_correct + negative_correct,
        "total": len(cases),
    }


async def run() -> dict:
    if not settings.upstage_api_key:
        print("오류: UPSTAGE_API_KEY가 backend/.env에 필요합니다.", file=sys.stderr)
        raise SystemExit(1)

    golden = json.loads(_GOLDEN_PATH.read_text(encoding="utf-8"))
    candidates = [OpenTabCandidate.model_validate(item) for item in golden["candidates"]]
    cases = golden["cases"]
    passages = [text for _kind, text in resolver._INTENT_PASSAGES] + [
        resolver.build_candidate_passage(candidate) for candidate in candidates
    ]
    query_vectors, passage_vectors = await asyncio.gather(
        embed_many([case["query"] for case in cases]),
        embed_many(passages, model=settings.embedding_passage_model),
    )

    original = (
        settings.tab_action_intent_score_floor,
        settings.tab_action_intent_margin,
        settings.tab_action_match_score_floor,
        settings.tab_action_match_margin,
    )

    current_responses = [
        resolver.resolve_from_vectors(vector, candidates, passage_vectors)
        for vector in query_vectors
    ]
    # 4096차원 코사인은 질의당 한 번만 계산한다. sweep에서는 이미 계산한 점수만 비교한다.
    score_rows: list[dict] = []
    intent_count = len(resolver._INTENT_PASSAGES)
    for vector in query_vectors:
        class_scores = resolver._class_scores(vector, passage_vectors[:intent_count])
        ranked = resolver._rank_candidates(vector, candidates, passage_vectors[intent_count:])
        score_rows.append(
            {
                "navigate": class_scores["navigate"],
                "other": max(score for kind, score in class_scores.items() if kind != "navigate"),
                "tab_id": ranked[0].candidate.id,
                "match": ranked[0].score,
                "match_margin": ranked[0].score - ranked[1].score,
            }
        )

    def predict(config: tuple[float, float, float, float]) -> list[str | None]:
        intent_floor, intent_margin, match_floor, match_margin = config
        return [
            row["tab_id"]
            if row["navigate"] >= intent_floor
            and row["navigate"] - row["other"] >= intent_margin
            and row["match"] >= match_floor
            and row["match_margin"] >= match_margin
            else None
            for row in score_rows
        ]

    sweep: list[dict] = []
    for intent_floor in (0.10, 0.12, 0.14, 0.16, 0.18):
        for intent_margin in (0.0, 0.01, 0.02, 0.03, 0.04):
            for match_floor in (0.14, 0.16, 0.18, 0.20, 0.22):
                for match_margin in (0.02, 0.04, 0.06, 0.08, 0.10):
                    config = (intent_floor, intent_margin, match_floor, match_margin)
                    metrics = _metrics(cases, predict(config))
                    sweep.append({"config": config, **metrics})
    sweep.sort(
        key=lambda row: (
            row["negative_correct"],
            row["total_correct"],
            row["positive_correct"],
            row["config"][1] + row["config"][3],
        ),
        reverse=True,
    )

    details = [
        {
            "id": case["id"],
            "expected": case["expected_tab_id"],
            "action": response.action,
            "reason": response.reason,
            "tab_id": response.tab_id,
            "score": response.score,
            "margin": response.margin,
            "correct": (
                response.tab_id == case["expected_tab_id"]
                if case["expected_tab_id"] is not None
                else response.action == "ask"
            ),
        }
        for case, response in zip(cases, current_responses)
    ]
    return {
        "current_config": original,
        "current_metrics": _metrics(cases, [response.tab_id for response in current_responses]),
        "details": details,
        "best_configs": sweep[:10],
    }


def main() -> int:
    report = asyncio.run(run())
    print("=== 열린 탭 자연어 resolver 실제 임베딩 평가 ===")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
