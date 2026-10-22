"""Regressions from the 42005d4 UI trial; providers and persistence are doubles."""

import asyncio
import json
import math
from pathlib import Path

import pytest

from app.api import ask
from app.schemas.session import SessionDetail
from app.services import assistant_router, sync_pipeline
from app.services.ask_service import AskContext, grounded_answer
from app.services.intent_analyzer import Assignment


@pytest.mark.parametrize("score", [None, float("nan"), float("inf")])
def test_append_requires_verified_similarity(score):
    # The trial's old sessions were all recent. Recency alone is not topic evidence.
    candidates = [
        {"session_id": "jeju", "title": "제주 여행 준비", "score": score, "last_activity_days_ago": 0},
        {"session_id": "react", "title": "React 상태 관리 학습", "score": score, "last_activity_days_ago": 0},
        {"session_id": "css", "title": "CSS Grid 학습", "score": score, "last_activity_days_ago": 0},
    ]
    assignments = [
        Assignment([0, 1, 2, 3, 4], "append", "jeju", "DB 및 컨테이너 학습"),
        Assignment([5, 6], "append", "react", "Python 학습"),
        Assignment([7, 8], "append", "css", "Blender 벤치마크"),
    ]

    gated = sync_pipeline._gate_appends(assignments, candidates)

    assert [a.action for a in gated] == ["create", "create", "create"]
    assert [a.target for a in gated] == [None, None, None]
    assert [a.title for a in gated] == ["DB 및 컨테이너 학습", "Python 학습", "Blender 벤치마크"]
    assert assignments[0].target == "jeju"


def test_append_to_missing_candidate_is_not_applied():
    gated = sync_pipeline._gate_appends([Assignment([0], "append", "missing")], [])
    assert gated[0].action == "create"
    assert gated[0].target is None


def test_dev_shared_observed_scores_route_to_memory():
    # Unit vectors with the observed top score and margin, no embedding API.
    def vector(score):
        return [score, math.sqrt(1 - score * score)]

    vectors = [vector(s) for s in [0.233781, 0.233781, 0.201332, 0.201332, 0.18, 0.18, 0.19, 0.19]]
    result = assistant_router.route_from_vectors([1.0, 0.0], vectors)
    assert result.intent == "search_memory"
    assert result.reason == "fallback"


class _ConnectedRequest:
    async def is_disconnected(self):
        return False


def test_grounded_detail_limitation_is_preserved():
    answer = "Blender 페이지를 방문했어요 [1]. 기록에서 세부 점수는 확인할 수 없어요."
    assert grounded_answer(answer, []) == answer


def test_gpu_answer_replay_cannot_deny_returned_records(monkeypatch, caplog):
    raw = json.loads((Path(__file__).parent / "fixtures/ui_trial_answer.json").read_text())

    async def replay(_system, _prompt):
        for index in range(0, len(raw["answer"]), 7):
            yield raw["answer"][index:index + 7], "replay"

    monkeypatch.setattr(ask, "chat_completion_stream_with_meta", replay)
    context = AskContext([SessionDetail.model_validate(s) for s in raw["sources"]], raw["query"])

    async def collect():
        return [chunk async for chunk in ask._answer_events(_ConnectedRequest(), context)]

    chunks = asyncio.run(collect())
    text = "".join(json.loads(chunk.split("data: ")[1])["text"] for chunk in chunks if chunk.startswith("event: delta"))
    assert "기록에 없습니다" not in text
    assert "Blender" in text and "[2]" in text
    assert "opendata.blender.org" in text
    assert "record denial" in caplog.text


def test_empty_generation_with_sources_is_not_silent_success(monkeypatch):
    async def empty(_system, _prompt):
        yield "   ", "replay"

    monkeypatch.setattr(ask, "chat_completion_stream_with_meta", empty)
    raw = json.loads((Path(__file__).parent / "fixtures/ui_trial_answer.json").read_text())

    async def collect():
        context = AskContext([SessionDetail.model_validate(raw["sources"][1])], "prompt")
        return [chunk async for chunk in ask._answer_events(_ConnectedRequest(), context)]

    chunks = asyncio.run(collect())
    text = "".join(json.loads(chunk.split("data: ")[1])["text"] for chunk in chunks if chunk.startswith("event: delta"))
    assert "Blender" in text and "[1]" in text
