import asyncio
import json
from datetime import datetime, timezone

from app.services import intent_analyzer
from app.services.intent_analyzer import Assignment

_VISITED_AT = datetime(2026, 8, 3, 5, 12, tzinfo=timezone.utc)


def _event(title: str = "title", domain: str = "example.com", **overrides) -> dict:
    base = {
        "title": title,
        "domain": domain,
        "active_duration_ms": 60000,
        "visited_at": _VISITED_AT,
        "search_query": None,
    }
    base.update(overrides)
    return base


def _candidate(session_id: str = "sess-1", title: str = "기존 세션", **overrides) -> dict:
    base = {"session_id": session_id, "title": title, "overview": "overview text", "keywords": ["a", "b"]}
    base.update(overrides)
    return base


def _mock_llm(monkeypatch, response: str, model: str = "A.X-K1"):
    async def fake(*_args, **_kwargs):
        return response, model

    monkeypatch.setattr(intent_analyzer, "chat_completion_intent", fake)


def test_empty_group_returns_empty_without_llm_call(monkeypatch):
    async def boom(*_a, **_k):
        raise AssertionError("빈 그룹은 LLM을 호출하면 안 됨")

    monkeypatch.setattr(intent_analyzer, "chat_completion_intent", boom)
    result = asyncio.run(intent_analyzer.analyze([], []))
    assert result == []


def test_append_resolves_target_label_to_session_id(monkeypatch):
    events = [_event()]
    candidates = [_candidate(session_id="sess-42")]
    response = json.dumps(
        {"assignments": [{"event_indices": [0], "action": "append", "target": "S0", "relevance": 0.9}]}
    )
    _mock_llm(monkeypatch, response)

    result = asyncio.run(intent_analyzer.analyze(events, candidates))
    assert len(result) == 1
    assert result[0].action == "append"
    assert result[0].target == "sess-42"
    assert result[0].relevance == 0.9
    assert result[0].model == "A.X-K1"


def test_append_with_out_of_range_target_downgrades_to_create(monkeypatch):
    events = [_event()]
    candidates = [_candidate()]
    response = json.dumps(
        {"assignments": [{"event_indices": [0], "action": "append", "target": "S9", "relevance": 0.5}]}
    )
    _mock_llm(monkeypatch, response)

    result = asyncio.run(intent_analyzer.analyze(events, candidates))
    assert result[0].action == "create"
    assert result[0].target is None


def test_append_with_no_candidates_downgrades_to_create(monkeypatch):
    events = [_event()]
    response = json.dumps(
        {"assignments": [{"event_indices": [0], "action": "append", "target": "S0", "relevance": 0.5}]}
    )
    _mock_llm(monkeypatch, response)

    result = asyncio.run(intent_analyzer.analyze(events, []))
    assert result[0].action == "create"
    assert result[0].target is None


def test_unknown_action_becomes_hold(monkeypatch):
    events = [_event()]
    response = json.dumps({"assignments": [{"event_indices": [0], "action": "delete", "relevance": 0.5}]})
    _mock_llm(monkeypatch, response)

    result = asyncio.run(intent_analyzer.analyze(events, []))
    assert result[0].action == "hold"


def test_out_of_range_indices_dropped_and_missing_go_to_hold(monkeypatch):
    events = [_event(), _event(), _event()]
    response = json.dumps(
        {"assignments": [{"event_indices": [0, 99, -1], "action": "create", "title": "t", "relevance": 0.5}]}
    )
    _mock_llm(monkeypatch, response)

    result = asyncio.run(intent_analyzer.analyze(events, []))
    assert len(result) == 2
    create_assignment = next(a for a in result if a.action == "create")
    assert create_assignment.event_indices == [0]
    hold_assignment = next(a for a in result if a.action == "hold")
    assert hold_assignment.event_indices == [1, 2]


def test_duplicate_indices_first_assignment_wins(monkeypatch):
    events = [_event(), _event()]
    response = json.dumps(
        {
            "assignments": [
                {"event_indices": [0, 1], "action": "create", "title": "first", "relevance": 0.5},
                {"event_indices": [1], "action": "discard", "relevance": 0.1},
            ]
        }
    )
    _mock_llm(monkeypatch, response)

    result = asyncio.run(intent_analyzer.analyze(events, []))
    assert len(result) == 1
    assert result[0].action == "create"
    assert result[0].event_indices == [0, 1]


def test_relevance_is_clamped_to_0_1(monkeypatch):
    events = [_event()]
    response = json.dumps({"assignments": [{"event_indices": [0], "action": "discard", "relevance": 5.0}]})
    _mock_llm(monkeypatch, response)

    result = asyncio.run(intent_analyzer.analyze(events, []))
    assert result[0].relevance == 1.0


def test_missing_relevance_defaults_to_zero(monkeypatch):
    events = [_event()]
    response = json.dumps({"assignments": [{"event_indices": [0], "action": "discard"}]})
    _mock_llm(monkeypatch, response)

    result = asyncio.run(intent_analyzer.analyze(events, []))
    assert result[0].relevance == 0.0


def test_llm_failure_falls_back_to_full_group_hold(monkeypatch):
    async def boom(*_a, **_k):
        raise RuntimeError("network error")

    monkeypatch.setattr(intent_analyzer, "chat_completion_intent", boom)

    events = [_event(), _event()]
    result = asyncio.run(intent_analyzer.analyze(events, []))
    assert len(result) == 1
    assert result[0].action == "hold"
    assert result[0].event_indices == [0, 1]
    assert result[0].model is None


def test_malformed_json_falls_back_to_hold(monkeypatch):
    _mock_llm(monkeypatch, "this is not json")
    events = [_event()]
    result = asyncio.run(intent_analyzer.analyze(events, []))
    assert result[0].action == "hold"


def test_assignments_not_a_list_falls_back_to_hold(monkeypatch):
    _mock_llm(monkeypatch, json.dumps({"assignments": "oops"}))
    events = [_event()]
    result = asyncio.run(intent_analyzer.analyze(events, []))
    assert result[0].action == "hold"


def test_candidate_line_includes_last_activity_when_present():
    line = intent_analyzer._format_candidate_line(
        0,
        {"title": "제목", "overview": "개요", "keywords": ["k"], "last_activity_days_ago": 3},
    )
    assert line == "[S0] 제목 | 개요 | k | 마지막 활동: 3일 전"

    today_line = intent_analyzer._format_candidate_line(
        1, {"title": "제목", "overview": "개요", "keywords": [], "last_activity_days_ago": 0}
    )
    assert today_line.endswith("마지막 활동: 오늘")


def test_candidate_line_omits_last_activity_when_absent():
    # 평가 골든셋처럼 last_activity_days_ago가 없는 후보는 기존 포맷 유지
    line = intent_analyzer._format_candidate_line(0, {"title": "제목", "overview": "개요", "keywords": []})
    assert "마지막 활동" not in line
