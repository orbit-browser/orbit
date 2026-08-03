import asyncio
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.api import sessions
from app.schemas.session import PatchSessionRequest, SessionSummary


def test_patch_session_title_length_boundary():
    assert PatchSessionRequest(title="a" * 100).title == "a" * 100

    with pytest.raises(ValidationError):
        PatchSessionRequest(title="a" * 101)


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
