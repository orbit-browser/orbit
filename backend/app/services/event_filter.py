"""인제스트 전처리 순수 함수 모음 (docs/data-model-v2.md §8, DB 접근 없음).

민감 도메인/경로 정규식은 extension/lib/sensitive-domains.ts와 의미가 동일해야 한다 —
한쪽을 변경하면 반드시 다른 쪽도 함께 갱신할 것(서버측 이중 방어, 클라이언트와 판정 불일치 방지).
"""

import hashlib
import re
from urllib.parse import parse_qs, parse_qsl, urlencode, urlsplit, urlunsplit

_SYSTEM_SCHEMES = {
    "chrome",
    "edge",
    "about",
    "chrome-extension",
    "moz-extension",
    "devtools",
    "file",
    "data",
    "javascript",
    "view-source",
}

_TRACKING_PARAM_PREFIXES = ("utm_",)
_TRACKING_PARAMS = {"gclid", "fbclid"}

# extension/lib/sensitive-domains.ts SENSITIVE_DOMAIN_PATTERNS 포팅
_SENSITIVE_DOMAIN_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in (
        r"(^|\.)(kbstar|shinhan|wooribank|nonghyup|nhbank|scbank)\.com$",
        r"(^|\.)(kebhana|kakaobank|kbanknow|tossbank)\.com$",
        r"(^|\.)(ibk|citibank|kdb)\.co\.kr$",
        r"(^|\.)(kftc|kfcc|suhyup-bank)\.(or\.kr|co\.kr)$",
        r"(^|\.)(mirae(asset)?|samsungfund|kbfg|nhqv|kiwoom|ebestsec|shinhaninvest)\.com$",
        r"(^|\.)(kbcard|shinhancard|samsungcard|hyundaicard|lottecard)\.com$",
        r"\.go\.kr$",
        r"(^|\.)(paypal|stripe|tosspayments|inicis|kakaopay|payco)\.com$",
        r"(^|\.)toss\.im$",
        r"(^|\.)kcp\.co\.kr$",
        r"(^|\.)(nhis|hira)\.or\.kr$",
    )
]

# extension/lib/sensitive-domains.ts SENSITIVE_PATH_PATTERNS 포팅
_SENSITIVE_PATH_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in (
        r"/(login|signin|sign-in|logon|auth)(/|$)",
        r"/(checkout|payment|billing)(/|$)",
        r"/(mypage|myaccount|account)/(password|security|payment)",
    )
]

_GOOGLE_HOST_RE = re.compile(r"(^|\.)google\.", re.IGNORECASE)

# AI 챗 서비스 — 대화가 SPA로 진행되며 같은 대화(/c/<id>, /chat/<id>) URL에
# ?messageId= 등 휘발성 쿼리가 붙어 dedup이 대화를 파편화한다(도그푸딩 2차 피드백).
# 이 도메인은 정규화 시 쿼리를 통째로 버려 같은 대화를 한 URL로 접는다.
_AI_CHAT_HOSTS = {
    "chatgpt.com",
    "chat.openai.com",
    "claude.ai",
    "gemini.google.com",
}


def _is_ai_chat_host(host: str) -> bool:
    host = host.lower()
    return host in _AI_CHAT_HOSTS or host.startswith("www.") and host[4:] in _AI_CHAT_HOSTS


def is_system_url(url: str) -> bool:
    """chrome:/about:/확장 페이지 등 시스템 URL이거나 빈/파싱불가 URL이면 True."""
    if not url or not url.strip():
        return True
    try:
        scheme = urlsplit(url).scheme.lower()
    except ValueError:
        return True
    if not scheme:
        return True
    return scheme in _SYSTEM_SCHEMES


def normalize_url(url: str) -> str:
    """fragment 제거 + utm_*/gclid/fbclid 제거 + query 파라미터 정렬.

    AI 챗 도메인은 query를 통째로 버린다 — 같은 대화(/c/<id>)에 붙는 휘발성 쿼리
    (messageId 등)로 dedup이 파편화되는 것을 막는다.
    """
    try:
        parts = urlsplit(url)
    except ValueError:
        return url

    if _is_ai_chat_host(parts.hostname or ""):
        return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))

    kept_params = [
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if not key.lower().startswith(_TRACKING_PARAM_PREFIXES)
        and key.lower() not in _TRACKING_PARAMS
    ]
    kept_params.sort(key=lambda kv: (kv[0], kv[1]))
    query = urlencode(kept_params)

    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, ""))


def is_sensitive_url(url: str) -> bool:
    """민감 도메인/경로 여부 — 본문 제거 판정용(이벤트 자체는 저장)."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return False

    host = parts.hostname or ""
    if any(pattern.search(host) for pattern in _SENSITIVE_DOMAIN_PATTERNS):
        return True
    if any(pattern.search(parts.path) for pattern in _SENSITIVE_PATH_PATTERNS):
        return True
    return False


def _first_query_value(query: str, param: str) -> str | None:
    values = parse_qs(query).get(param)
    return values[0] if values else None


def extract_search_query(url: str) -> str | None:
    """검색엔진 결과 페이지 URL에서 검색어를 추출 (docs/data-model-v2.md §8)."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return None

    host = (parts.hostname or "").lower()
    path = parts.path

    if _GOOGLE_HOST_RE.search(host) and path == "/search":
        return _first_query_value(parts.query, "q")
    if host == "search.naver.com" and path == "/search.naver":
        return _first_query_value(parts.query, "query")
    if host in ("youtube.com", "www.youtube.com") and path == "/results":
        return _first_query_value(parts.query, "search_query")
    if host in ("bing.com", "www.bing.com") and path == "/search":
        return _first_query_value(parts.query, "q")

    return None


def content_hash(text: str) -> str:
    """본문 sha256 hex — 빈 문자열이면 ''."""
    if not text:
        return ""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
