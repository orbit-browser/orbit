"""merge_suggest_floor 튜닝 — 병합 골든셋 세션 텍스트를 실 Upstage passage 임베딩으로 만들어
쌍별 코사인을 재고, 양성(합쳐야 함)/음성(합치면 안 됨) 분리 구간을 보고한다.

실 API 비용이 발생하므로(임베딩) 사용자가 요청한 경우에만 실행한다(AGENTS 규칙).
merge 경로는 두 저장 세션 벡터(둘 다 embedding-passage) 간 코사인이므로 passage 모델을 쓴다.

실행: cd backend && python -m eval.tune_merge_floor
"""

import asyncio
import json
import math
from pathlib import Path

from app.ai.embedding import embed_many
from app.config import settings

_GOLDEN = Path(__file__).parent / "merge_golden.json"


def _cosine(u: list[float], v: list[float]) -> float:
    dot = sum(a * b for a, b in zip(u, v))
    nu = math.sqrt(sum(a * a for a in u))
    nv = math.sqrt(sum(b * b for b in v))
    return dot / (nu * nv) if nu and nv else 0.0


async def main() -> None:
    data = json.loads(_GOLDEN.read_text(encoding="utf-8"))
    pairs = data["pairs"]

    # 고유 텍스트를 한 번에 임베딩(비용 절감)
    texts: list[str] = []
    index: dict[str, int] = {}
    for p in pairs:
        for text in (p["a"], p["b"]):
            if text not in index:
                index[text] = len(texts)
                texts.append(text)

    vectors = await embed_many(texts, model=settings.embedding_passage_model)

    scored = []
    for p in pairs:
        score = _cosine(vectors[index[p["a"]]], vectors[index[p["b"]]])
        scored.append((p["id"], p["should_merge"], score, p["note"]))

    scored.sort(key=lambda r: r[2], reverse=True)
    print(f"passage model: {settings.embedding_passage_model}")
    print(f"{'cosine':>7}  {'label':>10}  id")
    print("-" * 60)
    for pid, should, score, _note in scored:
        label = "MERGE" if should else "no-merge"
        print(f"{score:7.4f}  {label:>10}  {pid}")

    pos = [s for _, m, s, _ in scored if m]
    neg = [s for _, m, s, _ in scored if not m]
    pos_min, neg_max = min(pos), max(neg)
    print("-" * 60)
    print(f"positives(min..max): {min(pos):.4f} .. {max(pos):.4f}")
    print(f"negatives(min..max): {min(neg):.4f} .. {max(neg):.4f}")
    print(f"separation: pos_min={pos_min:.4f}  neg_max={neg_max:.4f}  gap={pos_min - neg_max:+.4f}")
    if pos_min > neg_max:
        rec = round((pos_min + neg_max) / 2, 2)
        print(f"완전 분리 — 권장 floor = 밴드 중앙값 ≈ {rec:.2f}")
    else:
        # 겹침 — floor를 스윕해 F1 최대 지점을 보고
        best = None
        f = 0.30
        while f <= 0.95:
            tp = sum(1 for s in pos if s >= f)
            fp = sum(1 for s in neg if s >= f)
            fn = len(pos) - tp
            prec = tp / (tp + fp) if (tp + fp) else 0.0
            rec_ = tp / (tp + fn) if (tp + fn) else 0.0
            f1 = 2 * prec * rec_ / (prec + rec_) if (prec + rec_) else 0.0
            if best is None or f1 > best[1]:
                best = (round(f, 2), f1, prec, rec_)
            f += 0.01
        print(f"겹침 있음 — F1 최대 floor={best[0]:.2f} (F1={best[1]:.2f}, P={best[2]:.2f}, R={best[3]:.2f})")


if __name__ == "__main__":
    asyncio.run(main())
