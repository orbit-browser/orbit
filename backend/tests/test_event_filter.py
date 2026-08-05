from app.services import event_filter


# ── is_system_url ────────────────────────────────────────────────


def test_system_url_schemes_are_rejected():
    system_urls = [
        "chrome://extensions",
        "edge://settings",
        "about:blank",
        "chrome-extension://abcdefg/page.html",
        "moz-extension://abcdefg/page.html",
        "devtools://devtools/bundled/x.html",
        "file:///C:/Users/user/a.txt",
        "data:text/html,<h1>hi</h1>",
        "javascript:alert(1)",
        "view-source:https://example.com",
    ]
    for url in system_urls:
        assert event_filter.is_system_url(url) is True, url


def test_empty_or_unparsable_url_is_system():
    assert event_filter.is_system_url("") is True
    assert event_filter.is_system_url("   ") is True
    assert event_filter.is_system_url("not a url") is True


def test_normal_https_url_is_not_system():
    assert event_filter.is_system_url("https://example.com/path") is False


# ── normalize_url ────────────────────────────────────────────────


def test_normalize_url_strips_fragment():
    assert event_filter.normalize_url("https://example.com/path#section") == (
        "https://example.com/path"
    )


def test_normalize_url_strips_tracking_params():
    url = "https://example.com/?utm_source=x&utm_medium=y&gclid=abc&fbclid=def&keep=1"
    assert event_filter.normalize_url(url) == "https://example.com/?keep=1"


def test_normalize_url_sorts_remaining_query_params():
    url = "https://example.com/search?b=2&a=1&c=3"
    assert event_filter.normalize_url(url) == "https://example.com/search?a=1&b=2&c=3"


def test_normalize_url_combines_all_rules():
    url = "https://example.com/search?utm_campaign=x&b=2&a=1#frag"
    assert event_filter.normalize_url(url) == "https://example.com/search?a=1&b=2"


def test_normalize_url_ai_chat_drops_all_query():
    # 같은 대화(/c/<id>)에 붙는 휘발성 쿼리(messageId 등)를 버려 dedup이 합치게 한다
    base = "https://chatgpt.com/c/6a73028c-4d7c-83ee-85f7-9b687dc52d90"
    assert event_filter.normalize_url(base + "?messageId=f9b2") == base
    assert event_filter.normalize_url(base) == base


def test_normalize_url_ai_chat_claude_and_fragment():
    assert (
        event_filter.normalize_url("https://claude.ai/chat/43984da3?foo=bar#x")
        == "https://claude.ai/chat/43984da3"
    )


def test_normalize_url_non_ai_chat_keeps_query():
    # AI 챗이 아닌 도메인은 기존 규칙(쿼리 보존·정렬) 유지
    assert (
        event_filter.normalize_url("https://flight.naver.com/x?b=2&a=1")
        == "https://flight.naver.com/x?a=1&b=2"
    )


# ── is_sensitive_url ─────────────────────────────────────────────


def test_sensitive_domain_is_detected():
    assert event_filter.is_sensitive_url("https://www.kbstar.com/main") is True
    assert event_filter.is_sensitive_url("https://open.kakaobank.com/") is True
    assert event_filter.is_sensitive_url("https://www.nhis.or.kr/") is True


def test_sensitive_path_is_detected():
    assert event_filter.is_sensitive_url("https://shop.example.com/checkout") is True
    assert event_filter.is_sensitive_url("https://app.example.com/mypage/password") is True
    assert event_filter.is_sensitive_url("https://site.example.com/auth") is True


def test_non_sensitive_url_is_not_flagged():
    assert event_filter.is_sensitive_url("https://www.google.com/search?q=rtx+5070") is False


def test_sensitive_url_unparsable_is_not_flagged():
    assert event_filter.is_sensitive_url("not a url") is False


# ── extract_search_query ─────────────────────────────────────────


def test_extract_search_query_google():
    url = "https://www.google.com/search?q=rtx+5070+review&hl=ko"
    assert event_filter.extract_search_query(url) == "rtx 5070 review"


def test_extract_search_query_google_other_tld():
    url = "https://www.google.co.kr/search?q=hello"
    assert event_filter.extract_search_query(url) == "hello"


def test_extract_search_query_naver():
    url = "https://search.naver.com/search.naver?query=도쿄+여행"
    assert event_filter.extract_search_query(url) == "도쿄 여행"


def test_extract_search_query_youtube():
    url = "https://www.youtube.com/results?search_query=lofi+hiphop"
    assert event_filter.extract_search_query(url) == "lofi hiphop"


def test_extract_search_query_bing():
    url = "https://www.bing.com/search?q=weather+seoul"
    assert event_filter.extract_search_query(url) == "weather seoul"


def test_extract_search_query_returns_none_for_unmatched_url():
    assert event_filter.extract_search_query("https://example.com/article/1") is None


def test_extract_search_query_returns_none_for_lookalike_domain():
    # "notbing.com"처럼 실제 검색엔진이 아닌 도메인은 제외
    assert event_filter.extract_search_query("https://notbing.com/search?q=x") is None
    assert event_filter.extract_search_query("https://notgoogle.com/search?q=x") is None


# ── content_hash ─────────────────────────────────────────────────


def test_content_hash_empty_string():
    assert event_filter.content_hash("") == ""


def test_content_hash_is_sha256_hex():
    import hashlib

    text = "hello world"
    expected = hashlib.sha256(text.encode("utf-8")).hexdigest()
    assert event_filter.content_hash(text) == expected


def test_content_hash_is_deterministic():
    assert event_filter.content_hash("abc") == event_filter.content_hash("abc")
    assert event_filter.content_hash("abc") != event_filter.content_hash("abd")
