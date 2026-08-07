from datetime import datetime, timedelta, timezone

from app.services.merge_suggester import (
    SessionMeta,
    evaluate_pair,
    keyword_overlap,
)

_BASE = datetime(2026, 8, 7, 5, 0, tzinfo=timezone.utc)


def _meta(
    id_: str,
    *,
    title: str = "제주도 항공권 검색",
    keywords: tuple[str, ...] = ("제주", "항공권"),
    event_count: int = 5,
    minutes: int = 0,
) -> SessionMeta:
    return SessionMeta(
        id=id_,
        title=title,
        keywords=keywords,
        event_count=event_count,
        order_ts=_BASE + timedelta(minutes=minutes),
    )


# ── keyword_overlap ──────────────────────────────────────────────


def test_overlap_uses_keyword_intersection():
    a = _meta("a", keywords=("제주", "항공권", "여행"))
    b = _meta("b", keywords=("항공권", "예약"))
    assert keyword_overlap(a, b) == ["항공권"]


def test_overlap_falls_back_to_title_tokens_when_no_keyword_overlap():
    a = _meta("a", keywords=("foo",), title="제주 항공권 예약")
    b = _meta("b", keywords=("bar",), title="제주 여행 계획")
    # keywords 교집합 없음 → 제목 토큰 교집합("제주")
    assert keyword_overlap(a, b) == ["제주"]


def test_overlap_empty_when_no_signal_shared():
    a = _meta("a", keywords=("제주", "항공권"), title="제주 항공권")
    b = _meta("b", keywords=("리액트", "훅"), title="리액트 훅 정리")
    assert keyword_overlap(a, b) == []


def test_overlap_ignores_single_char_tokens():
    a = _meta("a", keywords=(), title="a 항공권")
    b = _meta("b", keywords=(), title="a 여행")
    # "a"는 len<2라 무시 → 겹침 없음
    assert keyword_overlap(a, b) == []


# ── evaluate_pair: floor · AND 조건 ──────────────────────────────


def test_below_floor_returns_none():
    a, b = _meta("a"), _meta("b")
    assert evaluate_pair(a, b, 0.59, floor=0.6) is None


def test_above_floor_but_no_keyword_overlap_returns_none():
    a = _meta("a", keywords=("제주",), title="제주 항공권")
    b = _meta("b", keywords=("코딩",), title="파이썬 비동기")
    # 벡터는 통과해도 겹침 없으면 제안 안 함(AND)
    assert evaluate_pair(a, b, 0.9, floor=0.6) is None


def test_passes_when_floor_and_overlap_met():
    a = _meta("a", keywords=("제주", "항공권"))
    b = _meta("b", keywords=("항공권", "예약"))
    suggestion = evaluate_pair(a, b, 0.72, floor=0.6)
    assert suggestion is not None
    assert suggestion.score == 0.72
    assert suggestion.signals.keyword_overlap == ["항공권"]


def test_floor_boundary_is_inclusive():
    a = _meta("a")
    b = _meta("b")
    assert evaluate_pair(a, b, 0.6, floor=0.6) is not None


# ── evaluate_pair: 생존자 결정 ───────────────────────────────────


def test_survivor_is_higher_event_count():
    a = _meta("a", event_count=9)
    b = _meta("b", event_count=3)
    suggestion = evaluate_pair(a, b, 0.8, floor=0.6)
    assert suggestion.survivor_id == "a"
    assert suggestion.absorbed_id == "b"


def test_survivor_is_higher_event_count_regardless_of_argument_order():
    a = _meta("a", event_count=3)
    b = _meta("b", event_count=9)
    suggestion = evaluate_pair(a, b, 0.8, floor=0.6)
    assert suggestion.survivor_id == "b"


def test_survivor_tie_breaks_on_earlier_order_ts():
    a = _meta("a", event_count=5, minutes=10)
    b = _meta("b", event_count=5, minutes=0)
    suggestion = evaluate_pair(a, b, 0.8, floor=0.6)
    # 동률 → 이른 order_ts(b)가 생존
    assert suggestion.survivor_id == "b"


def test_survivor_tie_breaks_on_id_when_count_and_ts_equal():
    a = _meta("a", event_count=5, minutes=0)
    b = _meta("b", event_count=5, minutes=0)
    suggestion = evaluate_pair(a, b, 0.8, floor=0.6)
    # 동률·동시각 → 작은 id("a") 생존(결정적)
    assert suggestion.survivor_id == "a"
