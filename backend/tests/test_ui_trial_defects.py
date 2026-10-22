"""Regressions from the 42005d4 UI trial; providers and persistence are doubles."""

import asyncio
import json
import math
from pathlib import Path

import pytest

from app.api import ask
from app.schemas.session import SessionDetail
from app.services import assistant_router, intent_analyzer, sync_pipeline
from app.services.noise_filter import domain_counts
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


def _blender_cluster():
    # The fix1 trial's second batch: the two Blender pages fell into their own subcluster.
    page = {"domain": "opendata.blender.org", "title": "Blender - Open Data", "search_query": None}
    return [
        {**page, "id": "b1", "url": "https://opendata.blender.org/", "active_duration_ms": 11_149,
         "content_excerpt": "x" * 602},
        {**page, "id": "b2", "url": "https://opendata.blender.org/about/", "active_duration_ms": 12_194,
         "content_excerpt": "x" * 4000},
    ]


def test_llm_discard_of_repeat_domain_pages_becomes_create():
    events = _blender_cluster()
    gated = sync_pipeline._guard_discards(
        [Assignment([0, 1], "discard", relevance=0.1)], events, domain_counts(events)
    )
    assert [(a.action, a.event_indices, a.target) for a in gated] == [("create", [0, 1], None)]


def test_discard_guard_keeps_stray_visits_discarded():
    events = _blender_cluster() + [
        {"id": "s", "domain": "english.visitseoul.net", "url": "https://english.visitseoul.net/",
         "title": "Welcome to Seoul", "active_duration_ms": 11_909, "content_excerpt": "x"},
        {"id": "q", "domain": "opendata.blender.org", "url": "https://opendata.blender.org/benchmarks/",
         "title": "Blender", "active_duration_ms": 4_000, "content_excerpt": "x"},
    ]
    gated = sync_pipeline._guard_discards(
        [Assignment([0, 2, 3], "discard")], events, domain_counts(events)
    )
    # Single-domain visits and sub-10s glances stay discarded; only the evidenced page is kept.
    assert [(a.action, a.event_indices) for a in gated] == [("discard", [2, 3]), ("create", [0])]


def test_intent_event_line_shows_url_path_for_same_title_pages():
    lines = [intent_analyzer._format_event_line(i, e) for i, e in enumerate(_blender_cluster())]
    assert "경로:" not in lines[0]  # root path adds nothing
    assert "경로: /about/" in lines[1]


def test_dev_shared_observed_scores_route_to_memory():
    # Unit vectors with the observed top score and margin, no embedding API.
    def vector(score):
        return [score, math.sqrt(1 - score * score)]

    vectors = [vector(s) for s in [0.233781, 0.233781, 0.201332, 0.201332, 0.18, 0.18, 0.19, 0.19]]
    result = assistant_router.route_from_vectors([1.0, 0.0], vectors)
    assert result.intent == "search_memory"
    assert result.reason == "fallback"


@pytest.mark.parametrize(
    ("scores", "expected"),
    [
        # Class scores measured on the routing golden set (orbit-ui-trial-fix2/diagnostics/route_sweep.json).
        ((0.349717, 0.194527, 0.155416, 0.204939), "navigate_tab"),  # 아까 보던 데로 다시 가자
        ((0.252087, 0.17308, 0.173534, 0.158564), "navigate_tab"),  # take me back to the GitHub page
        ((0.23133, 0.223086, 0.177572, 0.222428), "search_memory"),  # 검색했던 모니터링 도구
        ((0.234045, 0.201296, 0.177697, 0.176798), "search_memory"),  # UI trial dev_shared
    ],
)
def test_indirect_navigation_routes_without_misrouting(scores, expected):
    def vector(score):
        return [score, math.sqrt(1 - score * score)]

    # _INTENT_PASSAGES order: navigate, navigate, find, find, session, session, memory, memory.
    vectors = [vector(s) for s in scores for _ in range(2)]
    assert assistant_router.route_from_vectors([1.0, 0.0], vectors).intent == expected


class _ConnectedRequest:
    async def is_disconnected(self):
        return False


def _displayed(chunks):
    """Apply the SSE contract like the extension: deltas append, replace overwrites."""
    text, kinds = "", []
    for chunk in chunks:
        kind = chunk.split("\n", 1)[0].removeprefix("event: ")
        kinds.append(kind)
        if kind in ("delta", "replace"):
            data = json.loads(chunk.split("data: ", 1)[1])["text"]
            text = text + data if kind == "delta" else data
    return text, kinds


@pytest.mark.parametrize(
    "answer",
    [
        "Blender 페이지를 방문했어요 [1]. 기록에서 세부 점수는 확인할 수 없어요.",
        # Normal answers the 6544154 pattern replaced (eval-engineer memo, 2026-10-22).
        "You also visited another page about Blender [1].",
        "Notion pages were opened [1].",
        "해당 세션에서 확인되지 않은 수치는 말씀드릴 수 없어요",
        "세부 비교표 기록은 없지만 Blender 페이지는 방문했어요 [1]",
        # 답변 규칙 4의 거절 문구 (origin #19·#25 프롬프트와 합칠 때 맞춘 것)
        "5070 최저가 정보는 기록에서 찾지 못했어요.",
        "그 정보는 기록에서 찾지 못했어요.",
    ],
)
def test_grounded_limitation_is_preserved(answer):
    assert grounded_answer(answer, []) == answer


@pytest.mark.parametrize(
    "answer",
    [
        "기록에 없습니다",
        "그 페이지는 탐색 기록에 없습니다. [1] 세션은 RTX 사양이었어요.",
        "I could not find any pages about that.",
        "There are no records of a benchmark page.",
    ],
)
def test_record_denial_is_replaced(answer):
    assert grounded_answer(answer, []) != answer


@pytest.mark.parametrize(
    "answer",
    [
        # model-eval-v1 R9 raw (2026-10-22): unanswerable items; the blind judge marked each refusal_ok.
        "강아지 슬개골 탈구 수술비에 대한 정보는 제공된 탐색 기록에 없습니다.  \n관련 기록 [1], [2], [3]은 각각 고양이 입양 준비, 불면증과 수면 리듬, 미세먼지와 공기청정기에 관한 내용을 다루고 있으며, 강아지 슬개골 탈구 수술비와 관련된 정보는 포함되어 있지 않습니다.  \n\n따라서, 강아지 슬개골 탈구 수술비는 제공된 자료를 기반으로 확인할 수 없습니다.",
        "제공된 관련 탐색 기록에는 아이폰 17 사전예약 날짜에 대한 정보가 없습니다.  \n따라서 아이폰 17 사전예약 날짜를 확인할 수 없습니다.  \n\n[1], [2], [3] 세션 모두 메모리 반도체, 전기차 배터리, LLM 및 RAG 기술에 관한 내용을 다루고 있으며, 아이폰 17 사전예약과 관련된 정보는 포함되어 있지 않습니다.  \n\n결론: 관련 기록이 없어 아이폰 17 사전예약 날짜를 확인할 수 없습니다.",
        "제공된 탐색 기록에는 골프 드라이버 비거리 늘리는 법과 관련된 내용이 없습니다. [1] 세션은 마라톤 대회, [2] 세션은 피클볼, [3] 세션은 생산성 기법(포모도로, GTD)에 관한 기록만 포함되어 있습니다. 따라서 이 질문에 답할 수 있는 관련 탐색 기록이 존재하지 않습니다.",
        "보스턴 마라톤 참가비에 대한 구체적인 정보는 제공된 탐색 기록에 없습니다. 관련 기록은 [1] 세션의 보스턴 마라톤 위키백과 페이지로, 대회의 역사, 자격 요건, 코스 변경, 한국 선수 활약상 등은 다루고 있지만 참가비 금액은 언급되어 있지 않습니다. 따라서 해당 페이지에서 참가비를 확인할 수 없습니다.",
        "제공된 탐색 기록에는 고양이 종합백신 접종 시기에 대한 정보가 포함되어 있지 않습니다. [1] 세션의 기록은 고양이의 일반적 특성과 중성화 수술에 관한 내용이며, [2]와 [3] 세션은 각각 수면 리듬과 찌개 요리법에 관한 기록입니다. 따라서 고양이 백신 접종 시기를 확인할 수 있는 관련 페이지가 없습니다.",
    ],
    ids=["f02-exaone", "f03-exaone", "f08-ax-k2", "n06-ax-k2", "n08-ax-k2"],
)
def test_refusal_of_missing_information_is_preserved(answer):
    raw = json.loads((Path(__file__).parent / "fixtures/ui_trial_answer.json").read_text())
    sources = [SessionDetail.model_validate(s) for s in raw["sources"]]
    assert grounded_answer(answer, sources) == answer


def test_gpu_answer_replay_streams_then_replaces_denial(monkeypatch, caplog):
    raw = json.loads((Path(__file__).parent / "fixtures/ui_trial_answer.json").read_text())

    async def replay(_system, _prompt):
        for index in range(0, len(raw["answer"]), 7):
            yield raw["answer"][index:index + 7], "replay"

    monkeypatch.setattr(ask, "chat_completion_stream_with_meta", replay)
    context = AskContext([SessionDetail.model_validate(s) for s in raw["sources"]], raw["query"])

    async def collect():
        return [chunk async for chunk in ask._answer_events(_ConnectedRequest(), context)]

    text, kinds = _displayed(asyncio.run(collect()))
    # The body streams first; the late correction is a single replace before done.
    assert kinds[:2] == ["sources", "delta"]
    assert kinds[-2:] == ["replace", "done"]
    assert "기록에 없습니다" not in text
    assert "Blender" in text and "[2]" in text
    assert "opendata.blender.org" in text
    assert "reason=record_denial" in caplog.text


def test_grounded_stream_has_no_replace(monkeypatch):
    async def fine(_system, prompt):
        prompts["generated"] = prompt
        yield "Blender 페이지를 ", "replay"
        yield "방문했어요 [1].", "replay"

    async def verify(prompt, answer):
        prompts["verified"] = prompt
        assert answer == "Blender 페이지를 방문했어요 [1]."
        return []

    prompts: dict[str, str] = {}
    monkeypatch.setattr(ask, "chat_completion_stream_with_meta", fine)
    monkeypatch.setattr(ask, "find_conflations", verify)
    raw = json.loads((Path(__file__).parent / "fixtures/ui_trial_answer.json").read_text())
    context = AskContext([SessionDetail.model_validate(raw["sources"][1])], "prompt")

    async def collect():
        return [chunk async for chunk in ask._answer_events(_ConnectedRequest(), context)]

    text, kinds = _displayed(asyncio.run(collect()))
    assert kinds == ["sources", "delta", "delta", "done"]
    assert text == "Blender 페이지를 방문했어요 [1]."
    # 검증기는 답변을 만든 것과 같은 프롬프트(같은 근거 범위)만 받는다.
    assert prompts["verified"] == prompts["generated"] == context.prompt


def test_empty_generation_with_sources_is_not_silent_success(monkeypatch):
    async def empty(_system, _prompt):
        yield "   ", "replay"

    monkeypatch.setattr(ask, "chat_completion_stream_with_meta", empty)
    raw = json.loads((Path(__file__).parent / "fixtures/ui_trial_answer.json").read_text())

    async def collect():
        context = AskContext([SessionDetail.model_validate(raw["sources"][1])], "prompt")
        return [chunk async for chunk in ask._answer_events(_ConnectedRequest(), context)]

    text, _kinds = _displayed(asyncio.run(collect()))
    assert "Blender" in text and "[1]" in text
