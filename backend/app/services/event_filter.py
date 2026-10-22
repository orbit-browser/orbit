"""인제스트 전처리 순수 함수 모음 (docs/data-model-v2.md §8, DB 접근 없음).

민감 도메인/경로 정규식은 extension/lib/sensitive-domains.ts와 의미가 동일해야 한다 —
한쪽을 변경하면 반드시 다른 쪽도 함께 갱신할 것(서버측 이중 방어, 클라이언트와 판정 불일치 방지).
"""

import hashlib
import re
import unicodedata
from urllib.parse import parse_qs, parse_qsl, unquote, urlencode, urlsplit, urlunsplit

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
        r"(^|\.)gov\.kr$",
        r"(^|\.)(hometax|wetax|minwon|epeople|efine|iros)\.go\.kr$",
        r"(^|\.)ecfs\.scourt\.go\.kr$",
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


def _decoded(text: str) -> str:
    """판정용 정규화. 이중 인코딩(%2540)까지 풀고 전각 문자(＠, ｌ)를 반각으로 접는다."""
    for _ in range(5):
        decoded = unicodedata.normalize("NFKC", unquote(text))
        if decoded == text:
            break
        text = decoded
    return text


def is_sensitive_url(url: str) -> bool:
    """민감 도메인/경로 여부 — 본문 제거 판정용(이벤트 자체는 저장)."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return False

    # 끝 점 호스트(hometax.go.kr.)와 인코딩한 경로(/%6Cogin/)도 같은 페이지다.
    host = _decoded(parts.hostname or "").rstrip(".")
    path = _decoded(parts.path)
    if any(pattern.search(host) for pattern in _SENSITIVE_DOMAIN_PATTERNS):
        return True
    if any(pattern.search(path) for pattern in _SENSITIVE_PATH_PATTERNS):
        return True
    return False


_PATH_PIECE = re.compile(r"[A-Za-z0-9]+")
_HEX_PIECE = re.compile(r"[0-9a-f]{12,}", re.IGNORECASE)
# 문서 id 같은 base64url 값은 -, _ 로 쪼개면 조각마다 짧아져서 통째로도 본다.
_ID_RUN = re.compile(r"[A-Za-z0-9_-]{16,}")


def _looks_secret(segment: str) -> bool:
    """문서 id·재설정 토큰·이메일·주문 번호처럼 사람을 특정하거나 접근 권한이 되는 경로 조각."""
    segment = _decoded(segment)
    if "@" in segment:
        return True
    for piece in _PATH_PIECE.findall(segment):
        if piece.isdigit():
            if len(piece) >= 8:
                return True
        elif _HEX_PIECE.fullmatch(piece):
            return True
        elif len(piece) >= 16 and any(c.isdigit() for c in piece):
            return True
    return any(
        any(c.isdigit() for c in run) and any(c.isupper() for c in run) and any(c.islower() for c in run)
        for run in _ID_RUN.findall(segment)
    )


def ai_safe_path(url: str) -> str:
    """외부 AI(임베딩·LLM)에 보낼 URL 경로. 쿼리·프래그먼트는 없고, 민감 URL과 .go.kr URL은 빈 문자열."""
    try:
        parts = urlsplit(url)
        path = parts.path
    except ValueError:
        return ""
    # .go.kr 공지 본문은 수집하지만(민감 도메인 아님) 그 경로는 외부 AI에 보내지 않는다 —
    # 민원·신청 페이지 경로에 접수 번호 같은 개인 식별 조각이 섞여도 사이트마다 형식이 달라 가려낼 수 없다.
    if is_sensitive_url(url) or _decoded(parts.hostname or "").rstrip(".").endswith(".go.kr"):
        return ""
    return "/".join(segment for segment in path.split("/") if not _looks_secret(segment))


def ai_safe_url(url: str) -> str:
    """Ask 프롬프트의 출처 URL. 사용자 화면의 링크는 원래 URL을 그대로 쓴다."""
    try:
        parts = urlsplit(url)
        port = f":{parts.port}" if parts.port else ""
    except ValueError:
        return ""
    if not parts.hostname:
        return ""
    return f"{parts.scheme}://{parts.hostname}{port}{ai_safe_path(url)}"


def _first_query_value(query: str, param: str) -> str | None:
    values = parse_qs(query).get(param)
    return values[0] if values else None


def _search_param(host: str, path: str) -> str | None:
    """검색엔진 결과 페이지면 검색어 쿼리 이름, 아니면 None."""
    if _GOOGLE_HOST_RE.search(host) and path == "/search":
        return "q"
    if host == "search.naver.com" and path == "/search.naver":
        return "query"
    if host in ("youtube.com", "www.youtube.com") and path == "/results":
        return "search_query"
    if host in ("bing.com", "www.bing.com") and path == "/search":
        return "q"
    return None


def extract_search_query(url: str) -> str | None:
    """검색엔진 결과 페이지 URL에서 검색어를 추출 (docs/data-model-v2.md §8)."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return None
    param = _search_param((parts.hostname or "").lower(), parts.path)
    return _first_query_value(parts.query, param) if param else None


# ── 팀 수집 전용 판정 (docs/team-collect-mode.md §2.1) ─────────────────────
# 개인 수집에는 쓰지 않는다. 확장의 같은 목록과 함께 바꾸고, 바꾸면 동의 문구 버전도 올린다.

# 로그인 화면으로 보이는 호스트. 경로 정규식(_SENSITIVE_PATH_PATTERNS)이 못 잡는 SSO 화면을 더 잡지만
# 모든 로그인 화면을 잡지는 못한다 — 동의 문구는 "로그인 주소로 보이는 페이지"까지만 약속한다.
_LOGIN_HOST_PREFIXES = ("login.", "accounts.", "sso.", "auth.", "signin.")
_LOGIN_PATHS = {"github.com": ("/session",)}

# 팀 수집 기본 제외(CTO 결정, v1은 사용자가 풀 수 없다): 웹메일·메신저. 검색 결과 페이지는 _search_param 으로 본다.
_TEAM_EXCLUDED_HOSTS = (
    "mail.google.com",
    "outlook.live.com",
    "outlook.office.com",
    "outlook.office365.com",
    "mail.naver.com",
    "mail.daum.net",
    "web.whatsapp.com",
    "web.telegram.org",
    "app.slack.com",
    "teams.microsoft.com",
    "messenger.com",
)
_TEAM_EXCLUDED_PATHS = {"discord.com": "/channels", "instagram.com": "/direct"}


def _host_matches(host: str, domain: str) -> bool:
    return host == domain or host.endswith("." + domain)


def is_team_blocked_url(url: str, excluded_domains: tuple[str, ...] | list[str] = ()) -> bool:
    """팀 스트림으로 보내지 않을 주소인가. 민감 URL·로그인 호스트·기본 제외·사용자 제외 목록.

    판정할 수 없는 주소도 막는다(실패 시 닫힘).
    """
    try:
        parts = urlsplit(url)
    except ValueError:
        return True
    host = _decoded(parts.hostname or "").rstrip(".").lower()
    if not host:
        return True
    path = _decoded(parts.path)
    if is_sensitive_url(url):
        return True
    if host.startswith(_LOGIN_HOST_PREFIXES):
        return True
    for domain, paths in _LOGIN_PATHS.items():
        if _host_matches(host, domain) and any(path == p or path.startswith(p + "/") for p in paths):
            return True
    if any(_host_matches(host, domain) for domain in _TEAM_EXCLUDED_HOSTS):
        return True
    for domain, prefix in _TEAM_EXCLUDED_PATHS.items():
        if _host_matches(host, domain) and (path == prefix or path.startswith(prefix + "/")):
            return True
    if _search_param(host, parts.path) is not None:
        return True
    return any(_host_matches(host, domain.strip(".").lower()) for domain in excluded_domains if domain)


def teammate_url(url: str) -> str:
    """팀원 응답에 싣는 페이지 주소. 쿼리·프래그먼트·계정 정보를 지우고, 민감 URL은 도메인만 남긴다(§7.3).

    경로는 남긴다 — 팀원이 링크로 열 수 있어야 한다. 제목·요약 속 검색어는 여기서 지우지 못한다.
    """
    try:
        parts = urlsplit(url)
        host = parts.hostname
        port = parts.port
    except ValueError:
        return ""
    if not host:
        return ""
    netloc = f"[{host}]" if ":" in host else host
    if port:
        netloc += f":{port}"
    path = "/" if is_sensitive_url(url) else (parts.path or "/")
    return urlunsplit((parts.scheme, netloc, path, "", ""))


def content_hash(text: str) -> str:
    """본문 sha256 hex — 빈 문자열이면 ''."""
    if not text:
        return ""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
