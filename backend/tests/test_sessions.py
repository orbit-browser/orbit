import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.api import sessions
from app.schemas.session import PatchSessionRequest, SessionSummary


def test_patch_session_alias_length_boundary():
    assert PatchSessionRequest(alias="a" * 100).alias == "a" * 100

    with pytest.raises(ValidationError):
        PatchSessionRequest(alias="a" * 101)


def test_patch_session_alias_is_optional_and_nullable():
    """별칭 지우기 경로 — null 을 보내면 원래 이름으로 되돌린다."""
    assert PatchSessionRequest().alias is None
    assert PatchSessionRequest(alias=None).alias is None
    assert PatchSessionRequest(alias="").alias == ""


def test_embedding_text_includes_title_and_summary_fields():
    summary = SessionSummary(
        overview="overview",
        purpose="purpose",
        highlights=["first", "second"],
    )

    assert sessions._build_embedding_text("session title", summary) == (
        "session title overview purpose first second"
    )


def test_pending_recovery_runs_sequentially(monkeypatch):
    calls: list[str] = []
    summary_session = SimpleNamespace(id="summary", tabs=[])
    embed_session = SimpleNamespace(
        id="embed",
        title="title",
        summary={"overview": "overview"},
    )

    async def fake_ai_update(session_id, _tabs):
        calls.append(f"summary:{session_id}:start")
        await asyncio.sleep(0)
        calls.append(f"summary:{session_id}:end")

    async def fake_embed(session_id, _title, _summary):
        calls.append(f"embed:{session_id}")

    monkeypatch.setattr(sessions, "_ai_update", fake_ai_update)
    monkeypatch.setattr(sessions, "_embed_and_upsert", fake_embed)

    asyncio.run(sessions._run_pending_recovery([summary_session], [embed_session]))

    assert calls == ["summary:summary:start", "summary:summary:end", "embed:embed"]


def _session_row(title="원래 이름", alias=None):
    """_to_detail 이 읽는 필드만 갖춘 세션 대역."""
    now = datetime(2026, 8, 12, 9, 0, tzinfo=timezone.utc)
    return SimpleNamespace(
        id="s1",
        title=title,
        alias=alias,
        tabs=[],
        summary={"overview": "개요"},
        summary_status="done",
        created_at=now,
        updated_at=now,
        last_activity_at=None,
        folder_id=None,
    )


def test_detail_shows_alias_as_title_and_keeps_original_hidden():
    """별칭이 있으면 표시 이름이 별칭이다 — 내부 title 은 응답에 실리지 않는다."""
    detail = sessions._to_detail(_session_row(title="GitHub 외 3개", alias="졸업논문 실험"))

    assert detail.title == "졸업논문 실험"
    assert detail.alias == "졸업논문 실험"


def test_detail_falls_back_to_title_without_alias():
    detail = sessions._to_detail(_session_row(title="GitHub 외 3개", alias=None))

    assert detail.title == "GitHub 외 3개"
    assert detail.alias is None


def test_patch_session_writes_alias_and_never_touches_title():
    session = _session_row(title="원래 이름", alias=None)
    committed: list[str] = []

    class _DB:
        async def commit(self):
            committed.append("commit")

        async def refresh(self, _obj):
            committed.append("refresh")

    async def fake_owned(_db, _session_id, _user_id):
        return session

    original = sessions._owned_session
    sessions._owned_session = fake_owned  # type: ignore[assignment]
    try:
        detail = asyncio.run(
            sessions.patch_session(
                "s1", PatchSessionRequest(alias="  졸업논문 실험  "), _DB(), "user-1"
            )
        )
    finally:
        sessions._owned_session = original  # type: ignore[assignment]

    assert session.title == "원래 이름"
    assert session.alias == "졸업논문 실험"
    assert detail.title == "졸업논문 실험"
    assert committed == ["commit", "refresh"]


def test_patch_session_with_blank_alias_clears_it():
    session = _session_row(title="원래 이름", alias="이전 별칭")

    class _DB:
        async def commit(self):
            pass

        async def refresh(self, _obj):
            pass

    async def fake_owned(_db, _session_id, _user_id):
        return session

    original = sessions._owned_session
    sessions._owned_session = fake_owned  # type: ignore[assignment]
    try:
        detail = asyncio.run(
            sessions.patch_session("s1", PatchSessionRequest(alias="   "), _DB(), "user-1")
        )
    finally:
        sessions._owned_session = original  # type: ignore[assignment]

    assert session.alias is None
    assert session.title == "원래 이름"
    assert detail.title == "원래 이름"
