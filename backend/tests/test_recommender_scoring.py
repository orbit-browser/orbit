"""추천 1차 점수 — 가중치와 신호 정의를 테스트로 고정한다.

가중치를 바꾸면 여기가 깨진다. 그게 목적이다.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.services.recommender.scoring import (
    WEIGHTS,
    RecommendationKind,
    SessionSignals,
    classify_kind,
    diversify,
    pick_top_candidates,
    recommendation_score,
)

_NOW = datetime(2026, 8, 7, 12, 0, tzinfo=timezone.utc)


def _signals(**overrides) -> SessionSignals:
    base = {
        "session_id": "s1",
        "title": "세션",
        "last_activity_at": _NOW,
        "open_task_count": 0,
        "distinct_visit_days": 1,
        "vector_score": None,
        "context_overlap": 0.0,
        "is_active": False,
    }
    base.update(overrides)
    return SessionSignals(**base)


def test_weights_sum_to_one():
    assert pytest.approx(sum(WEIGHTS.values())) == 1.0


def test_empty_session_scores_zero():
    """아무 신호도 없으면 0 — 최신순 기본값 같은 게 끼어들지 않는다."""
    scored = recommendation_score(_signals(last_activity_at=None), _NOW)
    assert scored.score == 0.0


def test_similarity_contributes_its_weight():
    scored = recommendation_score(_signals(last_activity_at=None, vector_score=1.0), _NOW)
    assert pytest.approx(scored.score) == WEIGHTS["similarity"]


def test_similarity_is_clamped_to_unit_range():
    high = recommendation_score(_signals(last_activity_at=None, vector_score=5.0), _NOW)
    low = recommendation_score(_signals(last_activity_at=None, vector_score=-2.0), _NOW)
    assert pytest.approx(high.score) == WEIGHTS["similarity"]
    assert low.score == 0.0


# ── recency ──────────────────────────────────────────────


def test_recency_is_full_for_just_now():
    scored = recommendation_score(_signals(), _NOW)
    assert pytest.approx(scored.components["recency"]) == 1.0


def test_recency_halves_every_three_days():
    three = recommendation_score(_signals(last_activity_at=_NOW - timedelta(days=3)), _NOW)
    six = recommendation_score(_signals(last_activity_at=_NOW - timedelta(days=6)), _NOW)
    assert pytest.approx(three.components["recency"], abs=1e-6) == 0.5
    assert pytest.approx(six.components["recency"], abs=1e-6) == 0.25


def test_recency_is_zero_without_activity_timestamp():
    scored = recommendation_score(_signals(last_activity_at=None), _NOW)
    assert scored.components["recency"] == 0.0


def test_future_timestamp_does_not_exceed_one():
    """시계 오차로 미래 시각이 들어와도 1을 넘지 않는다."""
    scored = recommendation_score(_signals(last_activity_at=_NOW + timedelta(hours=1)), _NOW)
    assert scored.components["recency"] == 1.0


# ── unfinished ──────────────────────────────────────────────


def test_unfinished_grows_with_open_tasks_and_saturates():
    none = recommendation_score(_signals(open_task_count=0), _NOW)
    one = recommendation_score(_signals(open_task_count=1), _NOW)
    three = recommendation_score(_signals(open_task_count=3), _NOW)
    many = recommendation_score(_signals(open_task_count=99), _NOW)

    assert none.components["unfinished"] == 0.0
    assert one.components["unfinished"] < three.components["unfinished"]
    assert three.components["unfinished"] == many.components["unfinished"]


def test_active_session_gets_unfinished_bonus():
    closed = recommendation_score(_signals(is_active=False), _NOW)
    active = recommendation_score(_signals(is_active=True), _NOW)
    assert active.components["unfinished"] > closed.components["unfinished"]


def test_unfinished_never_exceeds_one():
    scored = recommendation_score(_signals(open_task_count=99, is_active=True), _NOW)
    assert scored.components["unfinished"] <= 1.0


# ── revisit ──────────────────────────────────────────────


def test_single_day_session_has_no_revisit_signal():
    assert recommendation_score(_signals(distinct_visit_days=1), _NOW).components["revisit"] == 0.0


def test_revisit_saturates_at_four_days():
    four = recommendation_score(_signals(distinct_visit_days=4), _NOW)
    ten = recommendation_score(_signals(distinct_visit_days=10), _NOW)
    assert four.components["revisit"] == 1.0
    assert ten.components["revisit"] == 1.0


# ── 후보 선별 ──────────────────────────────────────────────


def test_pick_top_orders_by_score_and_limits():
    sessions = [
        _signals(session_id="low", last_activity_at=_NOW - timedelta(days=30)),
        _signals(session_id="high", vector_score=1.0, open_task_count=3),
        _signals(session_id="mid", vector_score=0.5),
    ]

    top = pick_top_candidates(sessions, _NOW, limit=2)

    assert [item.session_id for item in top] == ["high", "mid"]


def test_pick_top_breaks_ties_deterministically():
    """같은 입력이면 항상 같은 순서 — 추천이 매번 흔들리면 신뢰를 잃는다."""
    sessions = [_signals(session_id=sid) for sid in ("c", "a", "b")]

    first = [item.session_id for item in pick_top_candidates(sessions, _NOW)]
    second = [item.session_id for item in pick_top_candidates(list(reversed(sessions)), _NOW)]

    assert first == second == ["a", "b", "c"]


def test_pick_top_handles_empty_input():
    assert pick_top_candidates([], _NOW) == []


# ── 성격 분류 · 다양성 ──────────────────────────────────────


def test_context_match_classifies_as_related():
    scored = recommendation_score(_signals(context_overlap=0.9), _NOW)
    assert classify_kind(scored) is RecommendationKind.RELATED


def test_repeated_session_classifies_as_rediscover():
    scored = recommendation_score(_signals(distinct_visit_days=5), _NOW)
    assert classify_kind(scored) is RecommendationKind.REDISCOVER


def test_recent_unfinished_classifies_as_continue():
    scored = recommendation_score(_signals(open_task_count=2, is_active=True), _NOW)
    assert classify_kind(scored) is RecommendationKind.CONTINUE


def test_diversify_prefers_distinct_kinds():
    """같은 성격만 3개 나오면 '이어서 탐색'만 잔뜩 보인다."""
    items = [recommendation_score(_signals(session_id=f"s{i}"), _NOW) for i in range(4)]
    kinds = {
        "s0": RecommendationKind.CONTINUE,
        "s1": RecommendationKind.CONTINUE,
        "s2": RecommendationKind.RELATED,
        "s3": RecommendationKind.REDISCOVER,
    }

    picked = [item.session_id for item in diversify(items, kinds, count=3)]

    assert picked == ["s0", "s2", "s3"]


def test_diversify_falls_back_to_score_order_when_kinds_repeat():
    items = [recommendation_score(_signals(session_id=f"s{i}"), _NOW) for i in range(3)]
    kinds = {sid: RecommendationKind.CONTINUE for sid in ("s0", "s1", "s2")}

    picked = [item.session_id for item in diversify(items, kinds, count=3)]

    assert picked == ["s0", "s1", "s2"]


def test_diversify_returns_all_when_fewer_than_requested():
    items = [recommendation_score(_signals(session_id="s0"), _NOW)]
    assert len(diversify(items, {}, count=3)) == 1
