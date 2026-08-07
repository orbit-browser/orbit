"""배치 세션화 전처리 — 시간 그룹을 LLM에 넣기 전 임베딩으로 주제 선분리(순수 함수, IO 없음).

배경: 30분 시간 그룹에 이질 주제(항공권+코딩 등)가 섞이면 LLM(A.X/EXAONE)이 한 세션으로
뭉치는 불안정이 run마다 재현됐다(DecisionLog 2026-08-05 "[재확인] 그룹 간 과잉 append").
명백히 다른 주제만 결정적으로 선분리한 뒤 클러스터별로 LLM에 넘겨 뭉침을 구조적으로 막는다.

2026-07-05 결정("소표본·짧은 제목에서 임베딩 밀도 클러스터링은 불안정")을 존중해, 여기서
임베딩은 최종 주제 그룹을 만드는 것이 아니라 거친 선분리만 담당한다. 세밀한 판단은 여전히
LLM이 한다. 따라서 임계값은 보수적으로(명백히 다를 때만 쪼갬) 잡는다.
"""

import numpy as np


def _normalized_matrix(embeddings: list[list[float]]) -> np.ndarray:
    """(n, d) 행렬로 만들고 행 단위 L2 정규화한다(영벡터는 0으로 남겨 코사인 0 처리)."""
    matrix = np.asarray(embeddings, dtype=np.float64)
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1.0  # 영벡터 division 회피 — 결과 코사인은 0이 된다
    return matrix / norms


def subcluster(embeddings: list[list[float]], threshold: float) -> list[list[int]]:
    """이벤트 임베딩을 average-linkage 응집으로 서브클러스터링해 인덱스 그룹 목록을 반환한다.

    - 두 클러스터의 평균 코사인이 가장 큰 쌍을 반복 병합하되, 그 값이 threshold 미만이면 정지.
    - 결정적: tie-break는 (min index a, min index b) 오름차순, 출력은 등장 순서(각 클러스터의
      최소 인덱스) 기준 정렬 + 클러스터 내부 인덱스 오름차순.
    - 모든 이벤트가 서로 충분히 유사하면 [[0..n-1]] 하나로 반환(= 서브클러스터링 없음).

    Args:
        embeddings: 이벤트별 임베딩(순서 = 이벤트 순서).
        threshold: 병합 최소 평균 코사인. 낮을수록 덜 쪼갠다(보수적).
    """
    n = len(embeddings)
    if n <= 1:
        return [[0]] if n == 1 else []

    unit = _normalized_matrix(embeddings)
    sim = unit @ unit.T  # (n, n) 코사인 유사도 행렬

    clusters: list[list[int]] = [[i] for i in range(n)]

    while len(clusters) > 1:
        best_sim = -2.0
        best_pair: tuple[int, int] | None = None
        for a in range(len(clusters)):
            for b in range(a + 1, len(clusters)):
                # average-linkage: 두 클러스터 원소 간 코사인 평균
                block = sim[np.ix_(clusters[a], clusters[b])]
                avg = float(block.mean())
                if avg > best_sim:
                    best_sim = avg
                    best_pair = (a, b)

        if best_pair is None or best_sim < threshold:
            break

        a, b = best_pair
        clusters[a] = clusters[a] + clusters[b]
        del clusters[b]

    for cluster in clusters:
        cluster.sort()
    clusters.sort(key=lambda c: c[0])
    return clusters
