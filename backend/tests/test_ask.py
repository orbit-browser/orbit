import asyncio
import json
from types import SimpleNamespace

from app.api import ask
from app.schemas.ask import AskStreamRequest
from app.schemas.session import SessionDetail, SessionSummary
from app.services.ask_service import (
    AskContext,
    build_event_passage,
    build_answer_prompt,
    select_context_events,
)
from app.services import ask_service


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


async def rank_context_events(query, rows, budgets=None):
    scored = await ask_service.score_passages(query, rows)
    return {
        session_id: ask_service._pick_evidence(
            entries, (budgets or {}).get(session_id, ask_service.MIN_SESSION_BUDGET_CHARS)
        )
        for session_id, entries in scored.items()
    }


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


def test_event_passage_uses_content_but_excludes_url_query_and_fragment():
    event = SimpleNamespace(
        url="https://example.com/docs/router?token=secret#private",
        title="라우터 설계",
        domain="example.com",
        search_query="의도 라우터",
        content_excerpt="세션 검색과 탭 이동을 구분한다.",
    )

    passage = build_event_passage(event)

    assert "라우터 설계" in passage
    assert "세션 검색" in passage
    assert "docs/router" in passage
    assert "secret" not in passage
    assert "private" not in passage


def test_rank_context_events_prefers_question_semantics_over_stay_time(monkeypatch):
    rows = [
        (
            SimpleNamespace(session_id="session-1", relevance_score=1.0, sequence_order=0),
            SimpleNamespace(
                url="https://example.com/long",
                title="오래 본 무관한 페이지",
                domain="example.com",
                search_query=None,
                content_excerpt="여행 일정",
                active_duration_ms=100_000,
            ),
        ),
        (
            SimpleNamespace(session_id="session-1", relevance_score=0.1, sequence_order=1),
            SimpleNamespace(
                url="https://react.dev/state",
                title="Zustand 상태 관리",
                domain="react.dev",
                search_query="zustand 장점",
                content_excerpt="간단한 API와 작은 번들 크기가 장점이다.",
                active_duration_ms=100,
            ),
        ),
    ]

    async def fake_embed(_query: str):
        return [1.0, 0.0]

    async def fake_embed_many(passages: list[str], *, model: str | None = None):
        assert "오래 본 무관한 페이지" in passages[0]
        assert "Zustand" in passages[1]
        return [[0.0, 1.0], [1.0, 0.0]]

    monkeypatch.setattr(ask_service, "embed", fake_embed)
    monkeypatch.setattr(ask_service, "embed_many", fake_embed_many)

    selected = asyncio.run(rank_context_events("Zustand의 장점은?", rows))

    assert selected["session-1"][0].event.title == "Zustand 상태 관리"


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


def test_answer_events_for_session_discovery_skips_generation(monkeypatch):
    generation = monkeypatch.setattr(
        ask,
        "chat_completion_stream_with_meta",
        lambda *_args: (_ for _ in ()).throw(AssertionError("generation must not run")),
    )
    assert generation is None
    context = AskContext(sources=[_source()], prompt="", intent="find_sessions")

    events = asyncio.run(_collect_events(context))

    assert [event for event, _data in events] == ["sources", "delta", "done"]
    assert "관련 세션 1개" in events[1][1]["text"]
    assert events[-1][1]["model"] is None


def test_source_count_follows_retrieval_intent(monkeypatch):
    limits: list[int] = []

    async def fake_search(_query, limit, _rerank, _db, _user_id, **_kwargs):
        limits.append(limit)
        return []

    monkeypatch.setattr(ask, "_search_sessions_by_vector", fake_search)
    for intent in ("find_sessions", "search_session", "search_memory"):
        body = AskStreamRequest(query="질문", intent=intent)
        asyncio.run(ask._resolve_sources(body, SimpleNamespace(), "user-1"))

    assert limits == [5, 1, ask_service.MAX_CANDIDATE_SOURCES]


def test_prepare_context_falls_back_when_event_embedding_fails(monkeypatch):
    source = _source()
    row = (
        SimpleNamespace(session_id=source.session_id, relevance_score=1.0, sequence_order=0),
        SimpleNamespace(
            url="https://example.com/fallback",
            title="fallback page",
            domain="example.com",
            search_query=None,
            content_excerpt="fallback excerpt",
            active_duration_ms=100,
        ),
    )

    async def fake_load(_db, _session_ids, _user_id):
        return {source.session_id: SimpleNamespace(tabs=[])}, [row]

    async def fail_rank(*_args):
        raise RuntimeError("embedding unavailable")

    monkeypatch.setattr(ask_service, "_load_context_records", fake_load)
    monkeypatch.setattr(ask_service, "score_passages", fail_rank)

    context = asyncio.run(
        ask_service.prepare_ask_context(
            SimpleNamespace(), "질문", [source], "user-1", "search_memory"
        )
    )

    assert "fallback excerpt" in context.prompt


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


def test_split_passages_covers_whole_text_in_bounded_chunks():
    text = "머리말 " * 300 + "필요서류: 주민등록등본, 임대차계약서 사본, 재직증명서."

    passages = ask_service.split_passages(text)

    assert len(passages) > 1
    assert all(len(p) <= ask_service.PASSAGE_CHARS for p in passages)
    assert "재직증명서" in passages[-1]
    assert ask_service.split_passages("   ") == []


def test_rank_context_events_picks_relevant_passage_deep_in_page(monkeypatch):
    long_page = SimpleNamespace(
        url="https://blog.example.com/loan",
        title="전세대출 필요서류",
        domain="blog.example.com",
        search_query=None,
        content_excerpt="메뉴 로그인 공지 " * 200 + "\n필요서류: 주민등록등본, 임대차계약서 사본, 재직증명서.",
        active_duration_ms=1000,
    )
    rows = [(SimpleNamespace(session_id="s1", relevance_score=1.0, sequence_order=0), long_page)]

    async def fake_embed(_query: str):
        return [1.0, 0.0]

    async def fake_embed_many(passages: list[str], *, model: str | None = None):
        return [[1.0, 0.0] if "필요서류:" in p else [0.0, 1.0] for p in passages]

    monkeypatch.setattr(ask_service, "embed", fake_embed)
    monkeypatch.setattr(ask_service, "embed_many", fake_embed_many)

    selected = asyncio.run(rank_context_events("필요서류?", rows, {"s1": 800}))

    passages = selected["s1"][0].passages
    assert any("재직증명서" in p for p in passages)
    assert sum(len(p) for p in passages) <= 800


def test_rank_context_events_dedupes_repeated_visits(monkeypatch):
    def visit(order: int):
        return (
            SimpleNamespace(session_id="s1", relevance_score=1.0, sequence_order=order),
            SimpleNamespace(
                url="https://example.com/same",
                title="같은 페이지",
                domain="example.com",
                search_query=None,
                content_excerpt="같은 본문",
                active_duration_ms=100,
            ),
        )

    async def fake_embed(_query: str):
        return [1.0]

    async def fake_embed_many(passages: list[str], *, model: str | None = None):
        return [[1.0] for _ in passages]

    monkeypatch.setattr(ask_service, "embed", fake_embed)
    monkeypatch.setattr(ask_service, "embed_many", fake_embed_many)

    selected = asyncio.run(rank_context_events("질문", [visit(0), visit(1)]))

    assert len(selected["s1"]) == 1


def test_answer_prompt_includes_today_period_visit_time_and_citation_range():
    from datetime import datetime, timezone

    source = _source()
    event = SimpleNamespace(
        url="https://hotel.example.com/room?token=secret",
        title="그랜드 하버 호텔",
        domain="hotel.example.com",
        search_query="제주 호텔",
        visited_at=datetime(2026, 10, 13, 12, 20, tzinfo=timezone.utc),
    )
    evidence = {source.session_id: [ask_service.PageEvidence(event, ["체크인 15:00"])]}

    prompt = build_answer_prompt(
        "체크인 몇 시?",
        [source],
        {},
        evidence,
        {source.session_id: "2026-10-13(화) 21:05~21:37"},
        now=datetime(2026, 10, 19, 3, 0, tzinfo=timezone.utc),
    )

    assert "오늘: 2026-10-19(월)" in prompt
    assert "[1] 세션: 보험 비교 (2026-10-13(화) 21:05~21:37)" in prompt
    assert "10/13(화) 21:20 방문" in prompt
    assert "검색어: 제주 호텔" in prompt
    assert "체크인 15:00" in prompt
    assert "근거 번호: [1]" in prompt
    assert "secret" not in prompt


def _scored(session_id: str, score: float):
    event = SimpleNamespace(
        url=f"https://example.com/{session_id}",
        title=session_id,
        domain="example.com",
        search_query=None,
    )
    return {session_id: [(score, 0, 0, event, "본문")]}


def test_select_sources_keeps_second_topic_within_margin_and_drops_unrelated():
    sources = [_source("loan", "전세대출"), _source("rtx", "그래픽카드"), _source("job", "채용 공고")]
    scored = {**_scored("loan", 0.46), **_scored("rtx", 0.26), **_scored("job", 0.33)}

    selected = ask_service.select_sources(sources, scored)

    assert [s.session_id for s in selected] == ["loan", "job"]


def test_select_sources_drops_weak_secondary_even_within_margin():
    sources = [_source("job", "채용 공고"), _source("baseball", "야구 뉴스")]
    scored = {**_scored("job", 0.38), **_scored("baseball", 0.26)}

    selected = ask_service.select_sources(sources, scored)

    assert [s.session_id for s in selected] == ["job"]


def test_select_sources_keeps_unscorable_legacy_sessions():
    sources = [_source("legacy", "탭 스냅샷"), _source("loan", "전세대출")]

    selected = ask_service.select_sources(sources, _scored("loan", 0.5))

    assert {s.session_id for s in selected} == {"legacy", "loan"}


def test_prepare_context_numbers_only_selected_sources(monkeypatch):
    sources = [_source("loan", "전세대출"), _source("rtx", "그래픽카드")]

    async def fake_load(_db, _session_ids, _user_id):
        return {}, []

    async def fake_score(_query, _rows):
        return {**_scored("loan", 0.5), **_scored("rtx", 0.2)}

    monkeypatch.setattr(ask_service, "_load_context_records", fake_load)
    monkeypatch.setattr(ask_service, "score_passages", fake_score)

    context = asyncio.run(
        ask_service.prepare_ask_context(SimpleNamespace(), "금리?", sources, "user-1")
    )

    assert [s.session_id for s in context.sources] == ["loan"]
    assert "근거 번호: [1]" in context.prompt
    assert "그래픽카드" not in context.prompt


def test_candidate_dedupe_prefers_visit_with_captured_content():
    def visit(order: int, duration: int, excerpt: str):
        return (
            SimpleNamespace(session_id="s1", relevance_score=1.0, sequence_order=order),
            SimpleNamespace(url="https://example.com/same", content_excerpt=excerpt, active_duration_ms=duration),
        )

    limited = ask_service._limit_event_candidates(
        [visit(0, 600_000, ""), visit(1, 5_000, "필요서류: 재직증명서")]
    )

    assert [event.content_excerpt for _se, event in limited] == ["필요서류: 재직증명서"]
