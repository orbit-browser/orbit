import asyncio
import json
from types import SimpleNamespace

from app.api import ask
from app.schemas.session import SessionDetail, SessionSummary
from app.services.ask_service import (
    AskContext,
    build_answer_prompt,
    select_context_events,
)


def _source(session_id="session-1", title="보험 비교") -> SessionDetail:
    return SessionDetail(
        session_id=session_id,
        title=title,
        summary=SessionSummary(
            overview="보험 세 곳을 비교함",
            purpose="보험 선택",
            highlights=["A사가 저렴함"],
        ),
        summary_status="done",
        tabs=[],
        created_at="2026-08-01T00:00:00+00:00",
        updated_at="2026-08-01T01:00:00+00:00",
    )


def test_select_context_events_caps_each_session_and_prefers_score():
    rows = []
    for index in range(6):
        session_event = SimpleNamespace(
            session_id="session-1",
            relevance_score=float(index),
            sequence_order=index,
        )
        event = SimpleNamespace(
            active_duration_ms=100,
            content_excerpt=f"excerpt-{index}",
        )
        rows.append((session_event, event))

    selected = select_context_events(rows)

    assert [event.content_excerpt for event in selected["session-1"]] == [
        "excerpt-5", "excerpt-4", "excerpt-3", "excerpt-2"
    ]


def test_answer_prompt_contains_only_current_question_and_numbered_sources():
    source = _source()
    model = SimpleNamespace(
        tabs=[{"title": "보험 페이지", "url": "https://example.com", "text_content": "가격 정보"}]
    )
    prompt = build_answer_prompt(
        "결론은?",
        [source],
        {source.session_id: model},
        {},
    )

    assert "이전 대화" not in prompt
    assert "질문:\n결론은?" in prompt
    assert "[1] 세션: 보험 비교" in prompt
    assert "가격 정보" in prompt


class _ConnectedRequest:
    async def is_disconnected(self):
        return False


async def _collect_events(context: AskContext) -> list[tuple[str, dict]]:
    chunks = [chunk async for chunk in ask._answer_events(_ConnectedRequest(), context)]
    parsed = []
    for chunk in chunks:
        lines = chunk.strip().splitlines()
        parsed.append((lines[0].removeprefix("event: "), json.loads(lines[1].removeprefix("data: "))))
    return parsed


def test_answer_events_streams_sources_deltas_and_done(monkeypatch):
    async def fake_stream(_system, _prompt):
        yield "첫 ", "model-a"
        yield "답변", "model-a"

    monkeypatch.setattr(ask, "chat_completion_stream_with_meta", fake_stream)
    context = AskContext(sources=[_source()], prompt="prompt")

    events = asyncio.run(_collect_events(context))

    assert [event for event, _data in events] == ["sources", "delta", "delta", "done"]
    assert events[0][1]["sessions"][0]["session_id"] == "session-1"
    assert events[-1][1]["model"] == "model-a"


def test_answer_events_without_sources_returns_grounded_empty_message():
    events = asyncio.run(_collect_events(AskContext(sources=[], prompt="prompt")))
    assert [event for event, _data in events] == ["sources", "delta", "done"]
    assert "찾지 못했어요" in events[1][1]["text"]


def test_answer_events_marks_partial_stream_error(monkeypatch):
    async def interrupted(_system, _prompt):
        yield "일부", "model-a"
        raise ask.StreamInterruptedError("model-a")

    monkeypatch.setattr(ask, "chat_completion_stream_with_meta", interrupted)
    events = asyncio.run(_collect_events(AskContext(sources=[_source()], prompt="prompt")))

    assert events[-1] == (
        "error",
        {"code": "stream_interrupted", "partial": True, "retryable": True},
    )
