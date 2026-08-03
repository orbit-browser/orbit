"""평가 지표 순수 함수 (docs/evaluation-plan.md §5).

LLM 호출이나 DB 접근이 없어 backend/tests/test_eval_metrics.py에서 그대로 검증할 수 있다.

핵심 설계: LLM이 "새 세션 생성(create)"으로 판단한 이벤트는 실행 시점에 임의의(골든셋에는
없는) 세션 식별자를 얻는다 — 실제 운영에서도 새로 생성된 세션은 무작위 UUID를 받으므로
골든셋의 사람이 붙인 라벨("gpu_research" 등)과 문자열이 같을 수 없다. 따라서 정확도 계산
전에 "예측 클러스터별 다수결 정답 라벨"로 predicted_key를 리매핑한다(클러스터링 평가의
표준 기법 — purity 계산과 동일한 다수결 매핑을 재사용). append로 붙은 기존 세션은 애초에
골든셋 라벨을 predicted_key로 그대로 쓰므로(run_eval.py가 candidates[i]["session_id"]를
골든셋 키와 동일하게 채워 넣는다) 리매핑해도 결과가 바뀌지 않는다.
"""

from collections import Counter, defaultdict
from dataclasses import dataclass

NOISE = "noise"


@dataclass(frozen=True)
class EventOutcome:
    """이벤트 하나의 예측/정답 쌍.

    predicted_key: None이면 hold(어느 세션에도 배정되지 못함). "noise"면 discard 판정.
    그 외에는 세션을 가리키는 문자열 키(호출자가 scenario 단위로 네임스페이스를 부여해야
    서로 다른 골든셋 파일의 라벨이 우연히 충돌하지 않는다).
    expected_key: 골든셋 expected.assignments 값. "noise" 포함.
    """

    event_id: str
    predicted_key: str | None
    expected_key: str


@dataclass(frozen=True)
class ScenarioDecision:
    """골든셋 파일(배치) 하나의 new/existing 판단."""

    scenario_name: str
    expected: str  # "new" | "existing"
    predicted: str  # "new" | "existing"


def decide_new_vs_existing(actions: list[str]) -> str:
    """배치 전체에서 관측된 action 목록으로 new/existing 판단을 도출한다(순수 함수).

    append가 하나라도 있으면 기존 세션에 이어붙인 것이므로 "existing".
    append 없이 create가 있으면 "new". 그 외(hold/discard만 있는 등 신호가 없는 경우)는
    새 세션을 만들지 못한 것이므로 "new"로 기본 처리한다.
    """
    if "append" in actions:
        return "existing"
    return "new"


def _cluster_label_counts(outcomes: list["EventOutcome"]) -> dict[str, Counter]:
    """predicted_key별(noise/hold 제외)로 expected_key 분포를 센다."""
    clusters: dict[str, Counter] = defaultdict(Counter)
    for outcome in outcomes:
        if outcome.predicted_key is None or outcome.predicted_key == NOISE:
            continue
        clusters[outcome.predicted_key][outcome.expected_key] += 1
    return clusters


def build_cluster_label_map(outcomes: list[EventOutcome]) -> dict[str, str]:
    """예측 클러스터(predicted_key)별 다수결 정답 라벨 매핑을 만든다. noise/hold는 매핑 없음."""
    return {
        key: counter.most_common(1)[0][0]
        for key, counter in _cluster_label_counts(outcomes).items()
    }


def remap_predictions(outcomes: list[EventOutcome]) -> list[EventOutcome]:
    """predicted_key를 다수결 정답 라벨로 치환한 새 목록을 반환한다(원본은 불변)."""
    label_map = build_cluster_label_map(outcomes)
    return [
        EventOutcome(
            event_id=o.event_id,
            predicted_key=label_map.get(o.predicted_key, o.predicted_key),
            expected_key=o.expected_key,
        )
        for o in outcomes
    ]


def assignment_accuracy(outcomes: list[EventOutcome]) -> float | None:
    """Event-to-Session Assignment Accuracy = 일치 이벤트 수 / (N - |noise|).

    비교 전에 리매핑을 적용한다(위 모듈 docstring 참고). noise가 아닌 이벤트가
    하나도 없으면 정의되지 않으므로 None을 반환한다.
    """
    remapped = remap_predictions(outcomes)
    non_noise = [o for o in remapped if o.expected_key != NOISE]
    if not non_noise:
        return None
    correct = sum(1 for o in non_noise if o.predicted_key == o.expected_key)
    return correct / len(non_noise)


def session_purity(outcomes: list[EventOutcome]) -> float | None:
    """예측 클러스터별 지배적 정답 라벨 비율의 평균(클러스터 크기로 가중하지 않음).

    noise/hold로 판정된 이벤트는 애초에 "세션 클러스터"가 아니므로 계산에서 제외한다.
    예측 클러스터가 하나도 없으면 None.
    """
    clusters = _cluster_label_counts(outcomes)
    if not clusters:
        return None

    ratios = []
    for counter in clusters.values():
        total = sum(counter.values())
        dominant = counter.most_common(1)[0][1]
        ratios.append(dominant / total)
    return sum(ratios) / len(ratios)


def session_coverage(outcomes: list[EventOutcome]) -> float | None:
    """정답이 요구하는 세션 중 예측 결과에 실제로 대응되는(다수결로 매핑되는) 세션의 비율."""
    expected_labels = {o.expected_key for o in outcomes if o.expected_key != NOISE}
    if not expected_labels:
        return None

    clusters = _cluster_label_counts(outcomes)
    covered = {counter.most_common(1)[0][0] for counter in clusters.values()}
    return len(covered & expected_labels) / len(expected_labels)


def noise_exclusion_rate(outcomes: list[EventOutcome]) -> float | None:
    """noise로 라벨링된 이벤트 중 실제로 discard(predicted_key == NOISE)로 판정된 비율."""
    noise_events = [o for o in outcomes if o.expected_key == NOISE]
    if not noise_events:
        return None
    excluded = sum(1 for o in noise_events if o.predicted_key == NOISE)
    return excluded / len(noise_events)


def new_vs_existing_accuracy(decisions: list[ScenarioDecision]) -> float | None:
    """New-vs-Existing Decision Accuracy = 일치 배치 수 / 전체 배치 수."""
    if not decisions:
        return None
    correct = sum(1 for d in decisions if d.predicted == d.expected)
    return correct / len(decisions)
