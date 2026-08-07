"""노이즈 사전 필터 규칙 테스트 — 경계값과 구제 조건 중심."""

from app.services.noise_filter import is_short_stray, split_noise


def _event(url, *, duration_ms=10_000, domain=None, search_query=None, title=None, eid="e1"):
    from urllib.parse import urlsplit

    return {
        "id": eid,
        "url": url,
        "domain": domain if domain is not None else (urlsplit(url).hostname or ""),
        "active_duration_ms": duration_ms,
        "search_query": search_query,
        "title": title,
    }


def _single(event):
    """이벤트 하나만 담은 그룹에서 discard 여부."""
    _kept, noise_ids = split_noise([event])
    return event["id"] in noise_ids


# ── 규칙 1: 인증/로그인 경로 ──────────────────────────────


def test_login_path_short_is_noise():
    assert _single(_event("https://my.hanbat.ac.kr/login.do", duration_ms=3_000))


def test_login_path_long_dwell_survives():
    # 60초 이상 머문 로그인 화면은 버리지 않는다(로그인 후 체류 등)
    assert not _single(_event("https://my.hanbat.ac.kr/login.do", duration_ms=60_000))


def test_auth_boundary_59s_noise_60s_survives():
    assert _single(_event("https://x.com/auth/callback", duration_ms=59_999))
    assert not _single(_event("https://x.com/auth/callback", duration_ms=60_000))


# ── 규칙 2: 습관성 도메인(피드/쇼츠/포털 홈) ──────────────


def test_youtube_shorts_is_noise():
    assert _single(_event("https://www.youtube.com/shorts/aBcDeFg1234", duration_ms=14_000))


def test_youtube_watch_deeplink_survives():
    # 일반 영상 시청(watch)은 습관성 스침이 아니다
    assert not _single(_event("https://www.youtube.com/watch?v=abc", duration_ms=14_000))


def test_portal_home_short_is_noise():
    assert _single(_event("https://www.daum.net/", duration_ms=8_000))
    assert _single(_event("https://www.instagram.com/", duration_ms=12_000))


def test_naver_search_is_not_habitual_home():
    # search.naver.com은 홈이 아니라 검색 — 도메인 규칙에 걸리지 않는다
    assert not _single(_event("https://search.naver.com/search.naver?query=x", duration_ms=5_000))


# ── 규칙 3: 고립 루트 방문 ──────────────────────────────


def test_isolated_root_short_is_noise():
    # Kaggle 홈 29초, 그룹 내 유일 도메인 → 고립 루트로 discard
    assert _single(_event("https://www.kaggle.com/", duration_ms=29_000))


def test_root_boundary_30s_noise_31s_survives():
    assert _single(_event("https://example.com/", duration_ms=30_000))
    assert not _single(_event("https://example.com/", duration_ms=31_000))


def test_root_visit_not_isolated_survives():
    # 같은 도메인이 그룹에 2건 이상이면 구제(주제 흐름 가능성)
    group = [
        _event("https://shop.com/", duration_ms=10_000, eid="a"),
        _event("https://shop.com/product/1", duration_ms=200_000, eid="b"),
    ]
    _kept, noise_ids = split_noise(group)
    assert noise_ids == []


# ── 구제 조건 ──────────────────────────────────────────


def test_search_query_rescues():
    # 검색어가 있으면 짧아도 버리지 않는다
    assert not _single(
        _event("https://www.google.com/", duration_ms=5_000, search_query="제주 항공권")
    )


def test_none_duration_never_noise():
    # 체류 미측정은 불확실 → 버리지 않는다
    assert not _single(_event("https://www.instagram.com/", duration_ms=None))


def test_content_page_survives():
    # 딥 경로 콘텐츠 페이지는 어떤 규칙에도 안 걸린다
    assert not _single(_event("https://stackoverflow.com/questions/123", duration_ms=10_000))


# ── 그룹 통합: 실데이터 케이스 ───────────────────────────


def test_flight_group_keeps_flight_discards_strays():
    group = [
        _event("https://my.hanbat.ac.kr/login.do", duration_ms=3_000, eid="hanbat"),
        _event("https://www.kaggle.com/", duration_ms=29_000, eid="kaggle"),
        _event(
            "https://search.naver.com/search.naver?query=제주항공권",
            duration_ms=5_000,
            search_query="제주항공권",
            eid="search",
        ),
        _event(
            "https://flight.naver.com/flights/domestic/CJJ-CJU",
            duration_ms=42_000,
            eid="flight1",
        ),
        _event(
            "https://flight.naver.com/flights/domestic/detail/CJJ-CJU",
            duration_ms=5_000,
            eid="flight2",
        ),
    ]
    kept, noise_ids = split_noise(group)
    kept_ids = {e["id"] for e in kept}
    assert set(noise_ids) == {"hanbat", "kaggle"}
    # 검색어 있는 이벤트 + flight 2건(같은 도메인 반복)은 살아남는다
    assert kept_ids == {"search", "flight1", "flight2"}


# ── AI 챗 진입 화면 (도메인 반복 구제보다 우선) ──────────


def test_ai_chat_root_is_noise_even_with_domain_repeat():
    # chatgpt.com/ 진입 화면은 그룹에 chatgpt.com 대화가 여럿이어도 노이즈로 걸린다
    group = [
        _event("https://chatgpt.com/", duration_ms=31_000, eid="root"),
        _event("https://chatgpt.com/c/aaa", duration_ms=200_000, eid="conv1"),
        _event("https://chatgpt.com/c/bbb", duration_ms=200_000, eid="conv2"),
    ]
    kept, noise_ids = split_noise(group)
    assert noise_ids == ["root"]
    assert {e["id"] for e in kept} == {"conv1", "conv2"}


def test_claude_new_short_is_noise():
    group = [
        _event("https://claude.ai/new", duration_ms=5_000, eid="new"),
        _event("https://claude.ai/chat/xyz", duration_ms=200_000, eid="conv"),
    ]
    _kept, noise_ids = split_noise(group)
    assert noise_ids == ["new"]


def test_claude_new_long_dwell_survives():
    # /new에서 오래 머물면(새 대화 작성 중) 버리지 않는다
    assert not _single(_event("https://claude.ai/new", duration_ms=314_000))


def test_ai_chat_conversation_page_never_entry_noise():
    # 대화 페이지(/c/<id>)는 진입 화면 규칙에 걸리지 않는다(짧아도)
    assert not _single(_event("https://chatgpt.com/c/6a73028c", duration_ms=3_000))


# ── 메일 목록 보기 vs 개별 메일 읽기 ─────────────────────


def test_mail_inbox_list_is_noise():
    # 받은편지함·폴더 목록 보기는 체류 무관 discard(목록 새로고침은 기억 안 함)
    assert _single(_event("https://mail.console.nangman.cloud/mail/inbox", duration_ms=26_000))
    assert _single(_event("https://mail.naver.com/v2/folders/0/all", duration_ms=90_000))
    assert _single(_event("https://mail.console.nangman.cloud/mail/inbox?box=work", duration_ms=3_000))


def test_mail_message_read_survives():
    # 개별 메일 읽기는 보존해 LLM이 판단
    assert not _single(_event("https://mail.console.nangman.cloud/mail/message/8821", duration_ms=95_000))


def test_gmail_root_ambiguous_survives():
    # gmail은 경로 구분 불가(/mail/u/1/). title이 없으면 애매 → 보존(기존 C안 유지)
    assert not _single(_event("https://mail.google.com/mail/u/1/", duration_ms=4_000))


def test_gmail_inbox_title_is_noise():
    # 경로로는 못 잡지만 title이 받은편지함이면 discard(도그푸딩 검수 2026-08-06)
    assert _single(
        _event(
            "https://mail.google.com/mail/u/1/",
            duration_ms=4_000,
            title="받은편지함 (4,308) - donggun465@gmail.com - Gmail",
        )
    )


def test_naver_mail_root_inbox_title_is_noise():
    # naver 루트(/)도 title이 받은메일함이면 discard
    assert _single(
        _event(
            "https://mail.naver.com/",
            duration_ms=1_000,
            title="받은메일함(7028) : 네이버 메일",
        )
    )


def test_gmail_message_read_survives_by_subject_title():
    # 개별 메일 읽기는 title이 메일 '제목'이라 받은편지함으로 시작 안 함 → 보존
    assert not _single(
        _event(
            "https://mail.google.com/mail/u/1/",
            duration_ms=95_000,
            title="[GitHub] A new sign-in - donggun465@gmail.com - Gmail",
        )
    )


def test_mail_list_bypasses_domain_repeat_rescue():
    # 받은편지함이 버스트로 여러 건이어도(도메인 반복) 목록 보기는 전부 discard
    group = [
        _event("https://mail.console.nangman.cloud/mail/inbox", duration_ms=5_000, eid="m1"),
        _event("https://mail.console.nangman.cloud/mail/inbox?box=a", duration_ms=6_000, eid="m2"),
        _event("https://mail.console.nangman.cloud/mail/inbox?box=b", duration_ms=4_000, eid="m3"),
    ]
    kept, noise_ids = split_noise(group)
    assert kept == []
    assert set(noise_ids) == {"m1", "m2", "m3"}


def test_non_mail_host_unaffected():
    # 메일 호스트가 아니면 목록 규칙과 무관
    assert not _single(_event("https://flight.naver.com/flights/domestic/inbox", duration_ms=5_000))


# ── is_short_stray (hold 상한 처분) ─────────────────────


def test_is_short_stray():
    assert is_short_stray(_event("https://x.com/", duration_ms=5_000))
    assert not is_short_stray(_event("https://x.com/", duration_ms=120_000))
    assert not is_short_stray(
        _event("https://x.com/", duration_ms=5_000, search_query="검색")
    )
    assert not is_short_stray(_event("https://x.com/", duration_ms=None))
