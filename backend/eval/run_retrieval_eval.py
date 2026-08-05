"""검색 threshold 실측 평가 (docs/evaluation-plan.md §120 Retrieval Recall@K, §143).

세션 요약을 실제 파이프라인과 동일한 텍스트 구성(build_embedding_text)으로
embedding-passage 임베딩하고, 자연어 질의를 embedding-query로 임베딩한 뒤
코사인 점수 행렬에서 threshold 후보별 지표를 계산한다. Qdrant의 Cosine 점수와
동일한 값이므로 별도 컬렉션 없이 `search_score_threshold` 튜닝 근거로 쓸 수 있다.

실행 (backend 디렉터리에서, 실 임베딩 API 호출):
    python -m eval.run_retrieval_eval
"""

import asyncio
import json
import math
import sys
from pathlib import Path

from app.config import settings
from app.ai.embedding import embed
from app.schemas.session import SessionSummary
from app.services.embedding_sync import build_embedding_text

_GOLDEN_PATH = Path(__file__).parent / "golden_retrieval.json"
_THRESHOLDS = [round(0.20 + 0.05 * i, 2) for i in range(9)]  # 0.20 ~ 0.60
_TOP_K = 3


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return dot / norm if norm else 0.0


def _passage_text(session: dict) -> str:
    summary = SessionSummary(
        overview=session["overview"],
        purpose=session["purpose"],
        highlights=session["highlights"],
    )
    return build_embedding_text(session["title"], summary)


async def run() -> dict:
    if not settings.upstage_api_key:
        print("오류: UPSTAGE_API_KEY가 backend/.env에 필요합니다(실 임베딩 호출).", file=sys.stderr)
        raise SystemExit(1)

    golden = json.loads(_GOLDEN_PATH.read_text(encoding="utf-8"))
    sessions = golden["sessions"]
    positives = golden["positive_queries"]
    negatives = golden["negative_queries"]

    session_vecs = {
        s["id"]: await embed(_passage_text(s), model=settings.embedding_passage_model)
        for s in sessions
    }
    positive_vecs = [await embed(q["query"]) for q in positives]
    negative_vecs = [await embed(q) for q in negatives]

    # 질의별 (세션, 점수) 내림차순 랭킹
    def rank(query_vec: list[float]) -> list[tuple[str, float]]:
        scored = [(sid, _cosine(query_vec, vec)) for sid, vec in session_vecs.items()]
        return sorted(scored, key=lambda x: x[1], reverse=True)

    positive_ranks = [rank(v) for v in positive_vecs]
    negative_ranks = [rank(v) for v in negative_vecs]

    # 점수 분포 — 정답 세션 점수 vs 음성 질의 최고 점수
    answer_scores = []
    for q, ranked in zip(positives, positive_ranks):
        score = next((s for sid, s in ranked if sid == q["expected"]), 0.0)
        answer_scores.append({"query": q["query"], "expected": q["expected"], "score": round(score, 4)})
    negative_top = [
        {"query": q, "top_session": ranked[0][0], "top_score": round(ranked[0][1], 4)}
        for q, ranked in zip(negatives, negative_ranks)
    ]

    rows = []
    for threshold in _THRESHOLDS:
        recall_at_1 = recall_at_k = 0
        for q, ranked in zip(positives, positive_ranks):
            above = [(sid, s) for sid, s in ranked if s >= threshold]
            if above and above[0][0] == q["expected"]:
                recall_at_1 += 1
            if q["expected"] in {sid for sid, _ in above[:_TOP_K]}:
                recall_at_k += 1
        rejected = sum(1 for ranked in negative_ranks if all(s < threshold for _, s in ranked))
        rows.append(
            {
                "threshold": threshold,
                "recall@1": round(recall_at_1 / len(positives), 4),
                f"recall@{_TOP_K}": round(recall_at_k / len(positives), 4),
                "negative_rejection": round(rejected / len(negatives), 4),
            }
        )

    return {
        "config_current": settings.search_score_threshold,
        "sweep": rows,
        "answer_scores": sorted(answer_scores, key=lambda x: x["score"]),
        "negative_top_scores": sorted(negative_top, key=lambda x: -x["top_score"]),
    }


def main() -> int:
    report = asyncio.run(run())
    print("=== 검색 threshold 스윕 (Recall@1 / Recall@3 / 음성 질의 차단율) ===")
    for row in report["sweep"]:
        print(
            f"  {row['threshold']:.2f}: R@1={row['recall@1']*100:5.1f}%  "
            f"R@3={row['recall@3']*100:5.1f}%  차단={row['negative_rejection']*100:5.1f}%"
        )
    print()
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
