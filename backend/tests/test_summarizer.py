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
