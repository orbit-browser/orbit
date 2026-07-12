import asyncio

import pytest

from app.services import summarizer
from app.schemas.session import TabItemRequest
from app.services.summarizer import rule_based_title


def make_tab(title: str) -> TabItemRequest:
    return TabItemRequest(url="https://example.com", title=title, text_content="")


def test_rule_based_title_empty():
    assert rule_based_title([]) == "새 세션"


def test_rule_based_title_single_truncates_to_20_chars():
    long_title = "아주 긴 제목의 탭이라서 스무 글자를 넘길 수도 있는 경우입니다"
    assert rule_based_title([make_tab(long_title)]) == long_title[:20]


def test_rule_based_title_multiple_tabs():
    tabs = [make_tab("첫번째 탭"), make_tab("두번째 탭"), make_tab("세번째 탭")]
    assert rule_based_title(tabs) == "첫번째 탭 외 2개"


def test_generate_summary_returns_valid_result(monkeypatch):
    async def fake_llm(*_args, **_kwargs):
        return '{"title":"조사","overview":"자료를 비교하는 세션","highlights":[]}'

    monkeypatch.setattr(summarizer, "chat_completion", fake_llm)

    title, summary = asyncio.run(summarizer.generate_summary([make_tab("자료")]))

    assert title == "조사"
    assert summary.overview == "자료를 비교하는 세션"


def test_generate_summary_propagates_llm_failure(monkeypatch):
    async def failing_llm(*_args, **_kwargs):
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(summarizer, "chat_completion", failing_llm)

    with pytest.raises(RuntimeError, match="provider unavailable"):
        asyncio.run(summarizer.generate_summary([make_tab("자료")]))


def test_generate_summary_rejects_empty_overview(monkeypatch):
    async def fake_llm(*_args, **_kwargs):
        return '{"title":"조사","overview":"   ","highlights":[]}'

    monkeypatch.setattr(summarizer, "chat_completion", fake_llm)

    with pytest.raises(ValueError, match="overview is empty"):
        asyncio.run(summarizer.generate_summary([make_tab("자료")]))
