"""배치 세션화용 노이즈 사전 필터 — LLM 호출 전에 스침 방문을 결정적으로 걸러낸다.

배경: A.X-K1은 temperature 0에서도 초 단위 체류의 경계 이벤트 판정(discard/hold/혼입)이
실행 간 흔들리고, 프롬프트 보강 시도는 다른 시나리오를 회귀시켰다(DecisionLog
2026-08-05 "프롬프트 추가 보강 반려" / "노이즈 사전 필터" 결정). 규칙이 좁게 확실한
것만 버리고, 애매한 이벤트는 그대로 LLM에 넘긴다.

event_filter.py와 같은 순수 함수 모듈(DB 없음). 여기서 걸린 이벤트는 삭제가 아니라
sync_status='discarded'로만 표시된다 — Timeline에는 "제외됨" 뱃지로 계속 보인다.
"""

import re
from urllib.parse import urlsplit

from .event_filter import _is_ai_chat_host

# 임계값(ms) — 근거는 DecisionLog 2026-08-05 "노이즈 사전 필터" 항목.
# 실데이터에서 의미 있는 탐색도 5~42초였으므로 체류시간 단독으로는 절대 버리지 않고,
# 아래 규칙(경로/도메인 신호)과 결합해서만 쓴다.
_AUTH_DWELL_MAX_MS = 60_000
_HABITUAL_DWELL_MAX_MS = 60_000
_ISOLATED_ROOT_DWELL_MAX_MS = 30_000

# 규칙 1 — 인증/로그인 화면: 탐색 콘텐츠가 아니므로 세션 문맥에 기여하지 않는다.
# 세그먼트가 login.do, signin.php처럼 확장자를 달고 오는 경우까지 잡는다.
_AUTH_PATH_RE = re.compile(
    r"/(login|signin|sign-in|logon|logout|sso|auth|2fa)[^/]*(/|$)", re.IGNORECASE
)

# AI 챗 진입 화면 — 대화 id가 없는 루트/새 대화 화면(chatgpt.com/, claude.ai/new).
# 대화 페이지(/c/<id>, /chat/<id>)는 이 정규식에 걸리지 않아 살아남는다.
_AI_CHAT_ENTRY_PATH_RE = re.compile(r"^/(new|chats?)?/?$", re.IGNORECASE)

# 메일 목록/폴더 보기 — 받은편지함·폴더 새로고침은 탐색 기억 대상이 아니다(사용자 결정
# 2026-08-05: "실제로 읽은 메일만 기억"). 개별 메일 읽기(/message/<id>, /read/<id>)는
# 보존해 LLM이 판단하게 한다. 웹메일 호스트에서만 적용하며 도메인 반복 구제보다 우선한다
# (받은편지함 새로고침은 같은 도메인으로 여러 건 쌓여 구제 조건에 걸리기 때문).
# gmail은 정규화 후 경로가 /mail/u/N/ 하나라 목록/읽기 구분이 불가능 → 목록 규칙에 안 걸려
# 보존(LLM 판단)된다.
_MAIL_HOST_RE = re.compile(r"(^|\.)mail\.|(^|\.)outlook\.", re.IGNORECASE)
_MAIL_MESSAGE_PATH_RE = re.compile(r"/(messages?|read|msg|view)/", re.IGNORECASE)
_MAIL_LIST_PATH_RE = re.compile(
    r"/(inbox|folders?|sent|drafts?|spam|junk|trash|archive|starred|important|all|label)(/|$)",
    re.IGNORECASE,
)

# 규칙 2 — 습관적 확인 도메인: 피드/쇼츠/포털 홈. (host 정규식, path 정규식) 쌍으로
# 정의해 서비스 내 검색·글 상세 같은 의미 있는 방문(딥 경로)은 잡지 않는다.
_HABITUAL_PATTERNS: list[tuple[re.Pattern[str], re.Pattern[str]]] = [
    (re.compile(host, re.IGNORECASE), re.compile(path, re.IGNORECASE))
    for host, path in (
        (r"(^|\.)instagram\.com$", r"^/?$"),
        (r"(^|\.)(x|twitter)\.com$", r"^/(home)?/?$"),
        (r"(^|\.)facebook\.com$", r"^/?$"),
        (r"(^|\.)tiktok\.com$", r"^/(foryou)?/?$"),
        (r"(^|\.)youtube\.com$", r"^/(shorts(/.*)?)?/?$"),  # 홈 + 쇼츠
        (r"(^|\.)naver\.com$", r"^/?$"),
        (r"(^|\.)daum\.net$", r"^/?$"),
        (r"(^|\.)(nate|zum)\.com$", r"^/?$"),
    )
]


def _dwell_ms(event: dict) -> int | None:
    value = event.get("active_duration_ms")
    return value if isinstance(value, int) else None


def _is_auth_visit(path: str) -> bool:
    return bool(_AUTH_PATH_RE.search(path))


def _is_habitual_visit(host: str, path: str) -> bool:
    return any(h.search(host) and p.match(path) for h, p in _HABITUAL_PATTERNS)


def _is_root_path(path: str) -> bool:
    return path in ("", "/")


def _is_mail_list_view(host: str, path: str) -> bool:
    """웹메일의 받은편지함·폴더 목록 보기 여부. 개별 메일 읽기는 제외(보존)한다."""
    if not _MAIL_HOST_RE.search(host):
        return False
    if _MAIL_MESSAGE_PATH_RE.search(path):
        return False
    return bool(_MAIL_LIST_PATH_RE.search(path))


def is_noise(event: dict, domain_counts: dict[str, int]) -> bool:
    """그룹 문맥(domain_counts) 안에서 이벤트 하나의 노이즈 여부를 판정한다."""
    # 최우선 구제 — 검색어가 있으면 어떤 규칙보다 우선해 LLM에 보낸다.
    if event.get("search_query"):
        return False

    try:
        parts = urlsplit(event.get("url") or "")
    except ValueError:
        return False
    path = parts.path
    host = (parts.hostname or "").lower()
    domain = (event.get("domain") or "").lower()

    # 메일 목록/폴더 보기 — 체류·도메인 반복과 무관하게 discard(사용자 결정: 목록 새로고침은
    # 기억 안 함). 개별 메일 읽기는 _is_mail_list_view가 걸러 보존한다.
    if _is_mail_list_view(host, path):
        return True

    dwell = _dwell_ms(event)
    if dwell is None:
        return False  # 체류 미측정 — 불확실하면 버리지 않는다

    # AI 챗 진입 화면은 도메인 반복 구제보다 우선해서 걸러낸다 — AI 챗은 도메인 반복이
    # 흔해서(대화 여러 개) 구제 조건이 진입 화면까지 살려버리기 때문(도그푸딩 2차 피드백).
    if _is_ai_chat_host(host) and _AI_CHAT_ENTRY_PATH_RE.match(path) and dwell < _HABITUAL_DWELL_MAX_MS:
        return True

    # 같은 도메인 반복 = 주제 흐름일 가능성 → 구제
    if domain and domain_counts.get(domain, 0) >= 2:
        return False

    if _is_auth_visit(path) and dwell < _AUTH_DWELL_MAX_MS:
        return True
    if _is_habitual_visit(domain, path) and dwell < _HABITUAL_DWELL_MAX_MS:
        return True
    if _is_root_path(path) and dwell <= _ISOLATED_ROOT_DWELL_MAX_MS:
        return True
    return False


def split_noise(group: list[dict]) -> tuple[list[dict], list[str]]:
    """그룹을 (LLM에 보낼 이벤트, discard할 이벤트 id)로 나눈다."""
    domain_counts: dict[str, int] = {}
    for event in group:
        domain = (event.get("domain") or "").lower()
        if domain:
            domain_counts[domain] = domain_counts.get(domain, 0) + 1

    kept: list[dict] = []
    noise_ids: list[str] = []
    for event in group:
        if is_noise(event, domain_counts):
            noise_ids.append(event["id"])
        else:
            kept.append(event)
    return kept, noise_ids


def is_short_stray(event: dict) -> bool:
    """hold 상한 도달 이벤트의 최종 처분 판정 — 짧고 검색어 없는 방문이면 discard 대상.

    (session_updater의 hold 상한 정책: 강제 create가 스침 방문을 잡동사니 세션으로
    승격시키는 문제를 막는다 — DecisionLog 2026-08-05)
    """
    if event.get("search_query"):
        return False
    dwell = _dwell_ms(event)
    return dwell is not None and dwell < _AUTH_DWELL_MAX_MS
