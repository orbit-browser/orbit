"""외부 AI(임베딩·세션화 LLM·Ask)로 가는 URL에서 민감 경로와 비밀처럼 보이는 조각을 뺀다."""
from datetime import datetime
from types import SimpleNamespace

import pytest

from app.schemas.session import SessionDetail, SessionSummary
from app.services import ask_service, embedding_sync, intent_analyzer

GOOGLE_DOC = "https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit"
RESET_TOKEN = "https://shop.example.com/account/reset-password/9f8e7d6c5b4a3f2e1d0c"
EMAIL_PATH = "https://mail.example.com/u/hong.gildong@corp.com/inbox"
GO_KR = "https://www.hometax.go.kr/websquare/refund"
ENCODED_EMAIL = "https://mail.example.com/u/hong.gildong%40corp.com/inbox"
ORDER_NO = "https://shop.example.com/orders/20261022/detail"

SECRETS = ["1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms", "9f8e7d6c5b4a3f2e1d0c",
           "hong", "gildong", "corp", "websquare", "refund", "20261022"]


def _page_terms(url):
    return embedding_sync._page_terms({"title": "페이지", "url": url})


def _event_line(url):
    return intent_analyzer._format_event_line(0, {
        "title": "페이지", "domain": "x", "url": url, "active_duration_ms": 60_000,
        "visited_at": datetime(2026, 10, 22, 9, 0),
    })


@pytest.mark.parametrize("render", [_page_terms, _event_line])
@pytest.mark.parametrize("url", [GOOGLE_DOC, RESET_TOKEN, EMAIL_PATH, GO_KR, ENCODED_EMAIL, ORDER_NO])
def test_ai_inputs_drop_secret_path_segments(render, url):
    text = render(url)
    assert not [s for s in SECRETS if s in text], text


def test_page_terms_keep_meaningful_paths():
    assert _page_terms("https://react.dev/learn/thinking-in-react?x=secret#frag") == (
        "페이지 react.dev learn thinking in react"
    )
    assert _page_terms(GOOGLE_DOC) == "페이지 docs.google.com document d edit"
    assert _page_terms(EMAIL_PATH) == "페이지 mail.example.com u inbox"
    assert _page_terms(GO_KR) == "페이지 hometax.go.kr"
    # 모델 번호처럼 짧은 숫자와 대소문자 섞인 단어 경로는 남는다.
    assert _page_terms("https://www.nvidia.com/ko-kr/geforce/graphics-cards/50-series/rtx-5070/") == (
        "페이지 nvidia.com ko kr geforce graphics cards 50 series rtx 5070"
    )


def test_event_line_keeps_meaningful_path_and_drops_query():
    assert _event_line("https://react.dev/learn/thinking-in-react?x=secret#frag").endswith(
        "| 경로: /learn/thinking-in-react"
    )
    assert _event_line(RESET_TOKEN).endswith("| 경로: /account/reset-password")
    assert "경로" not in _event_line(GO_KR)


def _detail():
    return SessionDetail(
        session_id="s1", title="세션", summary=SessionSummary(overview="o", purpose="p"),
        summary_status="done", tabs=[], created_at="2026-10-22T00:00:00+00:00",
        updated_at="2026-10-22T01:00:00+00:00",
    )


def test_ask_prompt_source_urls_drop_query_fragment_and_sensitive_paths():
    events = [
        SimpleNamespace(title="React", domain="react.dev", content_excerpt="본문",
                        url="https://react.dev/learn/thinking-in-react?session=abc123#top"),
        SimpleNamespace(title="환급", domain="hometax.go.kr", content_excerpt="", url=GO_KR + "?id=1"),
        SimpleNamespace(title="", domain="", content_excerpt="", url=RESET_TOKEN),
    ]
    evidence = {"s1": [ask_service.PageEvidence(event, []) for event in events]}
    prompt = ask_service.build_answer_prompt("질문", [_detail()], {}, evidence)
    assert "(https://react.dev/learn/thinking-in-react)" in prompt
    assert "(https://www.hometax.go.kr)" in prompt
    assert "(https://shop.example.com/account/reset-password)" in prompt
    assert not [s for s in ["abc123", "#top", "refund", "id=1", "9f8e7d6c5b4a3f2e1d0c"] if s in prompt]


def test_ask_prompt_tab_fallback_urls_are_sanitized():
    model = SimpleNamespace(tabs=[{"title": "", "url": EMAIL_PATH + "?q=1", "excerpt": "x"}])
    prompt = ask_service.build_answer_prompt("질문", [_detail()], {"s1": model}, {})
    assert "- https://mail.example.com/u/inbox (https://mail.example.com/u/inbox)" in prompt
    assert "hong" not in prompt and "q=1" not in prompt


def test_event_passage_drops_secret_segments():
    event = SimpleNamespace(url=EMAIL_PATH, title="메일", domain="mail.example.com",
                            search_query=None, content_excerpt="")
    assert "경로: u/inbox" in ask_service.build_event_passage(event)
    event.url = GO_KR
    assert "경로" not in ask_service.build_event_passage(event)


def test_user_facing_fallback_answer_keeps_full_url():
    detail = _detail()
    detail.tabs = [SimpleNamespace(title="문서", url=GOOGLE_DOC)]
    assert GOOGLE_DOC in ask_service.grounded_answer("", [detail])


# --- 재검토(security-re.md): 남은 외부 AI 경로와 판정 우회 ---

from app.ai import clusterer
from app.schemas.session import TabItemRequest
from app.schemas.tab_action import OpenTabCandidate
from app.services import summarizer, tab_action_resolver
from app.services.event_filter import ai_safe_path, is_sensitive_url
from app.services.recommender import service as recommender_service
from app.services.recommender.llm_rerank import RecommendationContext

LEAKY = "https://site.com/account/reset-password/9f8e7d6c5b4a3f2e1d0c?token=abc&email=hong%40corp.com#x"
LEAKY_PARTS = ["9f8e7d6c5b4a3f2e1d0c", "token", "abc", "hong", "corp.com", "#x"]


def _tab(url):
    return TabItemRequest(url=url, title="비밀번호 재설정", text_content="본문")


def _leaks(text):
    return [s for s in LEAKY_PARTS if s in text]


def test_summarizer_prompt_sends_only_safe_url():
    text = summarizer._build_tabs_text([_tab(LEAKY)])
    assert "URL: https://site.com/account/reset-password\n" in text
    assert not _leaks(text), text


def test_clusterer_prompt_sends_only_safe_url():
    prompt = clusterer._build_prompt([_tab(LEAKY)])
    assert "— https://site.com/account/reset-password\n" in prompt
    assert not _leaks(prompt), prompt


def test_open_tab_passage_drops_secret_segments():
    passage = tab_action_resolver.build_candidate_passage(OpenTabCandidate(id="1", title="t", url=LEAKY))
    assert "경로: account/reset-password" in passage
    assert not _leaks(passage), passage


def test_recommendation_context_sends_only_safe_url(monkeypatch):
    sent = []

    async def fake_embed(text):
        sent.append(text)
        return [0.0]

    async def fake_search(*args, **kwargs):
        return []

    monkeypatch.setattr(recommender_service, "embed", fake_embed)
    monkeypatch.setattr(recommender_service, "search_similar_with_scores", fake_search)
    context = RecommendationContext(current_url=LEAKY)
    import asyncio
    asyncio.run(recommender_service._vector_scores(context, "u1"))
    assert sent == ["https://site.com/account/reset-password"]
    block = context.to_prompt_block()
    assert "현재 보고 있는 페이지: https://site.com/account/reset-password" in block
    assert not _leaks(block), block


@pytest.mark.parametrize("url", [
    "https://www.hometax.go.kr./websquare/refund",  # 끝 점 호스트
    "https://HOMETAX.GO.KR./x",
    "https://example.com/%6Cogin/step2",  # 인코딩한 민감 경로
    "https://example.com/%256Cogin/step2",  # 이중 인코딩
    "https://example.com/%EF%BD%8Cogin/step2",  # 전각 ｌ
])
def test_sensitive_url_survives_encoding_tricks(url):
    assert is_sensitive_url(url)
    assert ai_safe_path(url) == ""


@pytest.mark.parametrize("segment", [
    "hong.gildong%2540corp.com",  # 이중 인코딩 @
    "hong.gildong%EF%BC%A0corp.com",  # 전각 ＠
    "%EF%BC%91%EF%BC%92%EF%BC%93%EF%BC%94%EF%BC%95%EF%BC%96%EF%BC%97%EF%BC%98",  # 전각 숫자 8자
])
def test_secret_segment_survives_encoding_tricks(segment):
    assert ai_safe_path(f"https://mail.example.com/u/{segment}/inbox") == "/u/inbox"


def test_ingest_strips_excerpt_for_trailing_dot_sensitive_host():
    from app.api import events
    assert events.is_sensitive_url("https://hometax.go.kr./websquare/refund")


from app.services import event_filter


def test_go_kr_notice_is_collected_but_its_path_never_reaches_external_ai():
    """origin #24: .go.kr 공지 본문은 수집한다(민감 아님). 로컬 규칙: 외부 AI로 가는 .go.kr URL 경로는 지운다."""
    notice = "https://www.bokjiro.go.kr/ssis-tbu/cms/pc/customer/notice/130"
    assert event_filter.is_sensitive_url(notice) is False
    assert event_filter.ai_safe_path(notice) == ""
    assert event_filter.ai_safe_url(notice) == "https://www.bokjiro.go.kr"
    assert event_filter.ai_safe_path("https://soco.seoul.go.kr./youth/bbs/BMSR00013/view.do") == ""
    # .go.kr 이 아닌 일반 사이트의 경로는 그대로 쓴다
    assert event_filter.ai_safe_path("https://react.dev/learn/thinking-in-react") == "/learn/thinking-in-react"
