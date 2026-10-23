"""수동 저장(POST /sessions, /sessions/cluster)도 자동 수집과 같은 규칙으로 민감 본문을 서버에서 지운다.

확장이 본문을 보내더라도 서버가 마지막 경계다. 저장되는 tabs 와 AI(클러스터링·요약)로 가는 입력 모두에서 빠져야 한다.
"""

import asyncio
import uuid

import pytest

from fastapi import BackgroundTasks

from app.api import sessions
from app.schemas.session import SaveSessionRequest

_SECRET = "계좌번호 110-123-456789 잔액 3,000,000원"
_BANK = "https://www.kbstar.com/quics?page=C016505"
_PUBLIC = "https://docs.python.org/3/library/asyncio.html"


class _FakeDb:
    def __init__(self):
        self.added = []

    def add(self, row):
        row.id = row.id or str(uuid.uuid4())
        self.added.append(row)

    async def commit(self):
        pass

    async def refresh(self, row):
        pass


@pytest.fixture(autouse=True)
def _no_response_mapping(monkeypatch):
    # 응답 변환은 이 시험의 관심사가 아니다(가짜 DB는 created_at 을 채우지 않는다).
    monkeypatch.setattr(sessions, "_to_detail", lambda session, *args, **kwargs: session)


def _request() -> SaveSessionRequest:
    return SaveSessionRequest(
        tabs=[
            {"url": _BANK, "title": "KB 조회", "text_content": _SECRET, "excerpt": _SECRET},
            {"url": _PUBLIC, "title": "asyncio", "text_content": "event loop docs", "excerpt": "loop"},
        ]
    )


def _assert_scrubbed(tabs: list[dict]) -> None:
    by_url = {t["url"]: t for t in tabs}
    assert by_url[_BANK]["text_content"] == ""
    assert by_url[_BANK]["excerpt"] is None
    assert _SECRET not in repr(tabs)
    # 민감하지 않은 탭과 민감 탭의 URL·제목은 그대로 남는다(복원에 필요).
    assert by_url[_BANK]["title"] == "KB 조회"
    assert by_url[_PUBLIC]["text_content"] == "event loop docs"
    assert by_url[_PUBLIC]["excerpt"] == "loop"


def test_create_session_drops_sensitive_body_from_storage_and_ai_input():
    db, tasks = _FakeDb(), BackgroundTasks()
    asyncio.run(sessions.create_session(_request(), tasks, db=db, user_id="u1"))

    _assert_scrubbed(db.added[0].tabs)
    ai_tabs = tasks.tasks[0].args[1]
    _assert_scrubbed(ai_tabs)


def test_cluster_drops_sensitive_body_before_clustering_and_storage(monkeypatch):
    seen = []

    async def fake_cluster(tabs):
        seen.extend(t.model_dump() for t in tabs)
        return [tabs]

    monkeypatch.setattr(sessions, "cluster_tabs", fake_cluster)
    db, tasks = _FakeDb(), BackgroundTasks()
    asyncio.run(sessions.create_sessions_clustered(_request(), tasks, db=db, user_id="u1"))

    _assert_scrubbed(seen)
    _assert_scrubbed(db.added[0].tabs)
    _assert_scrubbed(tasks.tasks[0].args[1])
