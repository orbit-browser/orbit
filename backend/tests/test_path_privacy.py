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
    prompt = ask_service.build_answer_prompt("질문", [_detail()], {}, {"s1": events})
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
