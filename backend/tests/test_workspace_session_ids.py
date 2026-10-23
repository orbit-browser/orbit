"""팀 공유 세션 id 경로 — 범위·권한·304 (실제 SQL, 메모리 SQLite).

열린 새 탭이 8초마다 부르는 가벼운 경로다. 범위는 팀 목록·검색과 같아야 하고(탈퇴·공유 해제가 바로 빠짐),
목록이 그대로면 본문 없이 304 를 돌려준다.
"""

from tests.test_workspace_security import api, db  # noqa: F401 — 같은 시험 DB·앱을 쓴다

PATH = "/workspaces/alpha/sessions/ids"


def test_ids_match_the_team_list_and_skip_departed_or_absorbed(api):
    response = api("GET", PATH, user="bob")
    assert response.status_code == 200
    # absorbed(흡수됨)와 departed-share(공유자가 멤버 아님)는 빠진다.
    assert response.json() == {"session_ids": ["bob-shared", "shared"]}
    listed = sorted(s["session_id"] for s in api("GET", "/workspaces/alpha/sessions", user="bob").json())
    assert response.json()["session_ids"] == listed


def test_non_member_gets_404(api):
    assert api("GET", PATH, user="eve").status_code == 404
    assert api("GET", "/workspaces/missing/sessions/ids", user="bob").status_code == 404


def test_unchanged_list_returns_304_without_body(api):
    first = api("GET", PATH, user="bob")
    etag = first.headers["etag"]
    assert first.headers["cache-control"] == "private, no-cache"
    again = api("GET", PATH, user="bob", headers={"If-None-Match": etag})
    assert again.status_code == 304 and again.content == b"" and again.headers["etag"] == etag


def test_unshare_drops_the_id_at_once_and_changes_etag(api):
    etag = api("GET", PATH, user="bob").headers["etag"]
    assert api("DELETE", "/workspaces/alpha/sessions/shared", user="alice").status_code == 204
    after = api("GET", PATH, user="bob", headers={"If-None-Match": etag})
    assert after.status_code == 200
    assert after.json() == {"session_ids": ["bob-shared"]} and after.headers["etag"] != etag


def test_leaving_drops_sharers_ids_and_leaver_loses_access(api):
    etag = api("GET", PATH, user="alice").headers["etag"]
    assert api("DELETE", "/workspaces/alpha/members/bob", user="bob").status_code == 204
    after = api("GET", PATH, user="alice", headers={"If-None-Match": etag})
    assert after.status_code == 200 and after.json() == {"session_ids": ["shared"]}
    # 나간 사람은 옛 ETag 로도 304 를 받지 못한다 — 존재 자체를 404 로 숨긴다.
    assert api("GET", PATH, user="bob", headers={"If-None-Match": etag}).status_code == 404
