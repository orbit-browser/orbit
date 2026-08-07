"""추천 세션 1차 점수 — 규칙 + 임베딩으로 저렴하게 후보를 추린다.

여기서 걸러진 상위 K개만 LLM 리랭킹으로 넘어간다(`reranker.py`).
이 모듈은 **순수 함수만** 둔다 — DB·네트워크 없음. 가중치 조정을 테스트로 고정하기 위해서다.

가중치는 사용자가 지정한 값을 그대로 쓴다:

    score = 0.35*similarity + 0.30*unfinished + 0.15*recency
          + 0.10*revisit + 0.10*current_context
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum

WEIGHTS = {
    "similarity": 0.35,
    "unfinished": 0.30,
    "recency": 0.15,
    "revisit": 0.10,
    "current_context": 0.10,
}

# recency 반감기 — 3일 지나면 0.5, 6일이면 0.25.
# 탐색 맥락은 며칠이면 흐려진다는 가정. 너무 길면 오래된 세션이 계속 상위에 남는다.
_RECENCY_HALF_LIFE_DAYS = 3.0

# 미완료 신호 포화 지점 — 남은 할 일이 3개를 넘어도 더 급하다고 보지 않는다.
_UNFINISHED_SATURATION = 3

# 반복 방문 포화 지점 — 4일 이상 서로 다른 날에 봤으면 만점.
_REVISIT_SATURATION_DAYS = 4


class RecommendationKind(str, Enum):
    """추천 성격. 최종 3개는 가능하면 서로 다른 성격으로 섞는다."""

    CONTINUE = "continue"      # 최근 중단되어 바로 이어가기 좋음
    RELATED = "related"        # 지금 보는 내용과 연관됨
    REDISCOVER = "rediscover"  # 반복 탐색했거나 오래됐지만 다시 볼 가치 있음


@dataclass(frozen=True)
class SessionSignals:
    """한 세션에서 뽑아낸 추천 신호. 조회 계층이 채워서 넘긴다."""

    session_id: str
    title: str
    overview: str = ""
    last_activity_at: datetime | None = None
    #: 요약에 남아 있는 미완료 항목 수 (todos + next_actions)
    open_task_count: int = 0
    #: 서로 다른 날짜에 방문한 일수 — 하루만 봤으면 1
    distinct_visit_days: int = 1
    #: 세션 벡터와 기준 벡터의 코사인 유사도 (0~1). 계산 못 했으면 None
    vector_score: float | None = None
    #: 현재 탭/검색어와 직접 겹치는 정도 (0~1)
    context_overlap: float = 0.0
    #: 세션이 아직 열려 있는지 — 배치가 닫지 않은 진행 중 세션
    is_active: bool = True
    keywords: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class ScoredSession:
    signals: SessionSignals
    score: float
    #: 신호별 기여도 — 왜 뽑혔는지 추적하고 가중치를 조정할 때 본다
    components: dict[str, float]

    @property
    def session_id(self) -> str:
        return self.signals.session_id


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


def _similarity(signals: SessionSignals) -> float:
    return _clamp(signals.vector_score) if signals.vector_score is not None else 0.0


def _unfinished(signals: SessionSignals) -> float:
    """탐색이 끊겼거나 결론이 나지 않은 정도.

    남은 할 일이 주 신호이고, 아직 열려 있는 세션은 소폭 가산한다.
    할 일이 하나도 없고 닫힌 세션은 0 — 이어서 할 것이 없다는 뜻이다.
    """
    tasks = _clamp(signals.open_task_count / _UNFINISHED_SATURATION)
    open_bonus = 0.2 if signals.is_active else 0.0
    return _clamp(tasks * 0.8 + open_bonus)


def _recency(signals: SessionSignals, now: datetime) -> float:
    """최근일수록 1에 가깝다. 반감기 기반 지수 감쇠."""
    if signals.last_activity_at is None:
        return 0.0
    elapsed_days = (now - signals.last_activity_at).total_seconds() / 86_400
    if elapsed_days <= 0:
        return 1.0
    return _clamp(0.5 ** (elapsed_days / _RECENCY_HALF_LIFE_DAYS))


def _revisit(signals: SessionSignals) -> float:
    """여러 날에 걸쳐 다시 열어본 세션일수록 높다. 하루만 본 세션은 0."""
    extra_days = signals.distinct_visit_days - 1
    return _clamp(extra_days / (_REVISIT_SATURATION_DAYS - 1))


def recommendation_score(signals: SessionSignals, now: datetime) -> ScoredSession:
    """1차 점수를 계산한다. 반환값에 신호별 기여도를 함께 담는다."""
    components = {
        "similarity": _similarity(signals),
        "unfinished": _unfinished(signals),
        "recency": _recency(signals, now),
        "revisit": _revisit(signals),
        "current_context": _clamp(signals.context_overlap),
    }
    score = sum(WEIGHTS[name] * value for name, value in components.items())
    return ScoredSession(signals=signals, score=score, components=components)


def pick_top_candidates(
    sessions: list[SessionSignals],
    now: datetime,
    limit: int = 15,
) -> list[ScoredSession]:
    """점수 상위 후보만 남긴다 — LLM에는 이만큼만 넘어간다.

    동점은 세션 id 오름차순으로 깨서 같은 입력이면 항상 같은 순서가 나오게 한다
    (추천이 매번 흔들리면 사용자가 신뢰하지 못한다).
    """
    scored = [recommendation_score(s, now) for s in sessions]
    scored.sort(key=lambda item: (-item.score, item.session_id))
    return scored[:limit]


def classify_kind(scored: ScoredSession) -> RecommendationKind:
    """규칙 기반 성격 분류 — LLM이 성격을 주지 못했을 때의 폴백.

    기여도가 가장 큰 신호를 성격으로 읽는다.
    """
    components = scored.components
    if components["current_context"] >= 0.5 or components["similarity"] >= 0.6:
        return RecommendationKind.RELATED
    if components["revisit"] >= 0.5:
        return RecommendationKind.REDISCOVER
    if components["unfinished"] >= 0.4 and components["recency"] >= 0.3:
        return RecommendationKind.CONTINUE
    # 오래됐는데도 후보에 남았다면 다시 볼 가치가 있다는 뜻
    return (
        RecommendationKind.REDISCOVER
        if components["recency"] < 0.3
        else RecommendationKind.CONTINUE
    )


def diversify(
    scored: list[ScoredSession],
    kinds: dict[str, RecommendationKind],
    count: int = 3,
) -> list[ScoredSession]:
    """성격이 겹치지 않게 섞어 최종 N개를 고른다.

    같은 이유의 세션만 3개 나오면 "이어서 탐색"만 잔뜩 보이게 된다.
    서로 다른 성격을 먼저 채우고, 모자라면 점수순으로 메운다.
    """
    picked: list[ScoredSession] = []
    used_kinds: set[RecommendationKind] = set()

    for item in scored:
        kind = kinds.get(item.session_id)
        if kind is not None and kind not in used_kinds:
            picked.append(item)
            used_kinds.add(kind)
        if len(picked) == count:
            return picked

    for item in scored:
        if item not in picked:
            picked.append(item)
        if len(picked) == count:
            break
    return picked
