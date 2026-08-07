"""추천 LLM 리랭킹 — 응답을 신뢰하지 않는지 확인한다.

LLM이 이상한 걸 주거나 아예 실패해도 추천 3개는 나가야 한다.
"""

import asyncio
from datetime import datetime, timezone

import pytest

from app.services.recommender import llm_rerank
from app.services.recommender.llm_rerank import (
    RecommendationContext,
    rerank_recommendations,
)
from app.services.recommender.scoring import (
    RecommendationKind,
    SessionSignals,
    recommendation_score,
)

_NOW = datetime(2026, 8, 7, 12, 0, tzinfo=timezone.utc)


def _candidates(n: int = 5):
    return [
        recommendation_score(
            SessionSignals(
                session_id=f"s{i}",
                title=f"세션 {i}",
                overview="개요",
                last_activity_at=_NOW,
                open_task_count=i % 3,
                distinct_visit_days=1 + (i % 4),
            ),
            _NOW,
        )
        for i in range(n)
    ]


def _stub_llm(monkeypatch, result):
    async def fake(_system, _user, **_kwargs):
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(llm_rerank, "chat_completion", fake)


def _run(candidates, context=RecommendationContext(), count=3):
    return asyncio.run(rerank_recommendations(candidates, context, count=count))


# ── 정상 경로 ──────────────────────────────────────────────


def test_uses_llm_selection_and_reason(monkeypatch):
    _stub_llm(
        monkeypatch,
        '{"picks": [{"index": 2, "kind": "continue", "reason": "숙소 비교 도중 중단됨"}, '
        '{"index": 0, "kind": "related", "reason": "지금 보는 내용과 연관"}, '
        '{"index": 4, "kind": "rediscover", "reason": "4회 반복 탐색"}]}',
    )

    picks = _run(_candidates())

    assert [p.scored.session_id for p in picks] == ["s2", "s0", "s4"]
    assert picks[0].kind is RecommendationKind.CONTINUE
    assert picks[0].reason == "숙소 비교 도중 중단됨"


def test_context_block_includes_current_page_and_query():
    context = RecommendationContext(current_title="아반떼 vs K3", query="유지비")
    block = context.to_prompt_block()
    assert "아반떼 vs K3" in block
    assert "유지비" in block


def test_context_block_marks_empty_context():
    assert "없음" in RecommendationContext().to_prompt_block()


# ── LLM 응답을 신뢰하지 않는다 ──────────────────────────────


def test_falls_back_when_llm_raises(monkeypatch):
    _stub_llm(monkeypatch, RuntimeError("upstream down"))

    picks = _run(_candidates())

    assert len(picks) == 3
    assert all(p.reason for p in picks)


def test_falls_back_when_response_is_not_json(monkeypatch):
    _stub_llm(monkeypatch, "죄송합니다, 답변할 수 없습니다")
    assert len(_run(_candidates())) == 3


def test_falls_back_when_picks_missing(monkeypatch):
    _stub_llm(monkeypatch, '{"result": []}')
    assert len(_run(_candidates())) == 3


def test_out_of_range_index_is_dropped(monkeypatch):
    """존재하지 않는 후보를 가리키면 무시하고 나머지로 채운다."""
    _stub_llm(
        monkeypatch,
        '{"picks": [{"index": 99, "kind": "continue", "reason": "x"}, '
        '{"index": 1, "kind": "related", "reason": "ok"}]}',
    )

    picks = _run(_candidates())

    ids = [p.scored.session_id for p in picks]
    assert "s1" in ids
    assert len(picks) == 3
    assert len(set(ids)) == 3


def test_duplicate_index_is_deduped(monkeypatch):
    _stub_llm(
        monkeypatch,
        '{"picks": [{"index": 1, "kind": "continue", "reason": "a"}, '
        '{"index": 1, "kind": "related", "reason": "b"}]}',
    )

    picks = _run(_candidates())

    assert len({p.scored.session_id for p in picks}) == 3


def test_unknown_kind_falls_back_to_rule_classification(monkeypatch):
    _stub_llm(monkeypatch, '{"picks": [{"index": 0, "kind": "무엇인가", "reason": "r"}]}')

    picks = _run(_candidates())

    assert isinstance(picks[0].kind, RecommendationKind)


def test_empty_reason_is_replaced_with_generated_one(monkeypatch):
    _stub_llm(monkeypatch, '{"picks": [{"index": 0, "kind": "continue", "reason": "   "}]}')

    picks = _run(_candidates())

    assert picks[0].reason.strip()


def test_overlong_reason_is_truncated(monkeypatch):
    _stub_llm(
        monkeypatch,
        '{"picks": [{"index": 0, "kind": "continue", "reason": "' + "가" * 300 + '"}]}',
    )

    picks = _run(_candidates())

    assert len(picks[0].reason) <= 60


# ── 경계 ──────────────────────────────────────────────


def test_no_candidates_returns_empty(monkeypatch):
    _stub_llm(monkeypatch, RuntimeError("should not be called"))
    assert _run([]) == []


def test_skips_llm_when_candidates_fit_result_count(monkeypatch):
    """후보가 3개 이하면 고를 것이 없다 — LLM을 부르지 않는다(비용)."""
    called = False

    async def fake(_system, _user, **_kwargs):
        nonlocal called
        called = True
        return "{}"

    monkeypatch.setattr(llm_rerank, "chat_completion", fake)

    picks = _run(_candidates(2))

    assert called is False
    assert len(picks) == 2


def test_generated_reasons_reflect_signals():
    """폴백 이유가 신호를 반영해야 한다 — 아무 문장이나 붙이면 의미가 없다."""
    tasks = recommendation_score(
        SessionSignals(session_id="a", title="t", open_task_count=2, last_activity_at=_NOW),
        _NOW,
    )
    repeated = recommendation_score(
        SessionSignals(session_id="b", title="t", distinct_visit_days=4, last_activity_at=_NOW),
        _NOW,
    )

    assert "2개" in llm_rerank._fallback_reason(tasks, RecommendationKind.CONTINUE)
    assert "4일" in llm_rerank._fallback_reason(repeated, RecommendationKind.REDISCOVER)
