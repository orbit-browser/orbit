"""세션 임베딩 저장과 소유자 payload backfill."""

import asyncio
from types import SimpleNamespace

from app.schemas.session import SessionSummary
from app.services import embedding_sync


class _SessionCtx:
    def __init__(self, db):
        self._db = db

    async def __aenter__(self):
        return self._db

    async def __aexit__(self, *_exc):
        return False


class _FakeDB:
    def __init__(self, owner=None, rows=None, tabs=None):
        self.owner = owner
        self.rows = rows or []
        self.tabs = tabs or []
        self.session = SimpleNamespace(embedding_status="pending")

    async def scalar(self, _stmt):
        return self.owner

    async def execute(self, _stmt):
        return SimpleNamespace(
            all=lambda: self.rows,
            first=lambda: (self.owner, self.tabs) if self.owner else None,
        )

    async def get(self, _model, _pk):
        return self.session if self.owner else None

    async def commit(self):
        pass


def _summary() -> SessionSummary:
    return SessionSummary(overview="개요", purpose="목적", highlights=[])


def test_embed_and_upsert_stores_owner_in_payload(monkeypatch):
    db = _FakeDB(owner="u1")
    upserts: list = []

    async def fake_embed(_text, model):
        return [0.1]

    async def fake_upsert(session_id, _vector, payload):
        upserts.append((session_id, payload))

    monkeypatch.setattr(embedding_sync, "AsyncSessionLocal", lambda: _SessionCtx(db))
    monkeypatch.setattr(embedding_sync, "embed", fake_embed)
    monkeypatch.setattr(embedding_sync, "upsert_point", fake_upsert)

    asyncio.run(embedding_sync.embed_and_upsert("s1", "제목", _summary()))

    assert upserts[0][0] == "s1"
    assert upserts[0][1]["user_id"] == "u1"
    assert db.session.embedding_status == "done"


def test_embedding_text_includes_page_titles_and_url_paths(monkeypatch):
    # UI trial: the React session summary mixed six topics and missed the reset/sharing questions.
    db = _FakeDB(owner="u1", tabs=[
        {"title": "Preserving and Resetting State – React",
         "url": "https://react.dev/learn/preserving-and-resetting-state"},
        {"title": "Jeju", "url": "https://www.visitjeju.net/en/detail/view?contentsid=CNTS_000000000022574"},
    ])
    texts: list[str] = []

    async def fake_embed(text, model):
        texts.append(text)
        return [0.1]

    async def fake_upsert(*_args):
        pass

    monkeypatch.setattr(embedding_sync, "AsyncSessionLocal", lambda: _SessionCtx(db))
    monkeypatch.setattr(embedding_sync, "embed", fake_embed)
    monkeypatch.setattr(embedding_sync, "upsert_point", fake_upsert)

    asyncio.run(embedding_sync.embed_and_upsert("s1", "React 상태 관리 심화 학습", _summary()))

    assert texts == [
        "React 상태 관리 심화 학습 개요 목적 "
        "Preserving and Resetting State – React react.dev learn preserving and resetting state "
        "Jeju visitjeju.net en detail view"
    ]


def test_embed_and_upsert_skips_deleted_session(monkeypatch):
    """요약 중에 세션이 지워졌으면 고아 포인트를 만들지 않는다."""
    db = _FakeDB(owner=None)
    called: list = []

    async def fake_embed(*_a, **_k):
        called.append("embed")
        return [0.1]

    monkeypatch.setattr(embedding_sync, "AsyncSessionLocal", lambda: _SessionCtx(db))
    monkeypatch.setattr(embedding_sync, "embed", fake_embed)

    asyncio.run(embedding_sync.embed_and_upsert("gone", "제목", _summary()))

    assert called == []


def test_backfill_groups_points_by_owner(monkeypatch):
    db = _FakeDB(rows=[("s1", "u1"), ("s2", "u2"), ("s3", "u1")])
    applied: dict = {}

    async def fake_missing():
        return ["s1", "s2", "s3", "orphan"]

    async def fake_set_owner(user_id, session_ids):
        applied[user_id] = session_ids

    monkeypatch.setattr(embedding_sync, "AsyncSessionLocal", lambda: _SessionCtx(db))
    monkeypatch.setattr(embedding_sync, "point_ids_missing_owner", fake_missing)
    monkeypatch.setattr(embedding_sync, "set_owner", fake_set_owner)

    asyncio.run(embedding_sync.backfill_owner_payload())

    assert applied == {"u1": ["s1", "s3"], "u2": ["s2"]}


def test_backfill_does_nothing_when_all_points_have_owner(monkeypatch):
    async def fake_missing():
        return []

    def fail_session():
        raise AssertionError("DB를 열 필요가 없다")

    monkeypatch.setattr(embedding_sync, "point_ids_missing_owner", fake_missing)
    monkeypatch.setattr(embedding_sync, "AsyncSessionLocal", fail_session)

    asyncio.run(embedding_sync.backfill_owner_payload())


def test_backfill_failure_does_not_block_startup(monkeypatch):
    async def failing_missing():
        raise RuntimeError("qdrant down")

    monkeypatch.setattr(embedding_sync, "point_ids_missing_owner", failing_missing)

    asyncio.run(embedding_sync.backfill_owner_payload())  # 예외를 올리지 않는다


def test_reembed_sessions_reuses_embed_and_upsert(monkeypatch):
    full = {"overview": "개요", "purpose": "목적", "highlights": []}
    db = _FakeDB(rows=[("s1", "제목1", full), ("broken", "제목2", None), ("s2", "제목3", full)])
    calls: list = []

    async def fake_embed_and_upsert(session_id, title, summary):
        calls.append((session_id, title, summary.overview))

    monkeypatch.setattr(embedding_sync, "AsyncSessionLocal", lambda: _SessionCtx(db))
    monkeypatch.setattr(embedding_sync, "embed_and_upsert", fake_embed_and_upsert)

    assert asyncio.run(embedding_sync.reembed_sessions()) == 2
    assert calls == [("s1", "제목1", "개요"), ("s2", "제목3", "개요")]


# ── 재임베딩 명령 안전장치 ────────────────────────────────


def _cli_doubles(monkeypatch, count=3):
    calls: dict = {"count": [], "reembed": []}

    async def fake_count(user_id=None):
        calls["count"].append(user_id)
        return count

    async def fake_reembed(user_id=None):
        calls["reembed"].append(user_id)
        return count

    monkeypatch.setattr(embedding_sync, "count_reembed_targets", fake_count)
    monkeypatch.setattr(embedding_sync, "reembed_sessions", fake_reembed)
    monkeypatch.setattr(
        embedding_sync.settings, "database_url", "postgresql+asyncpg://orbit:s3cret@db.local:5433/orbit_dev"
    )
    return calls


def test_reembed_cli_without_scope_exits_before_any_call(monkeypatch):
    calls = _cli_doubles(monkeypatch)

    try:
        embedding_sync.main([])
    except SystemExit as exc:
        assert exc.code == 2
    else:
        raise AssertionError("scope is required")
    assert calls == {"count": [], "reembed": []}


def test_reembed_cli_rejects_empty_user_id(monkeypatch):
    calls = _cli_doubles(monkeypatch)

    try:
        embedding_sync.main(["--user-id", " "])
    except SystemExit as exc:
        assert exc.code == 2
    else:
        raise AssertionError("empty user id must not fall back to all users")
    assert calls == {"count": [], "reembed": []}


def test_reembed_cli_stops_without_yes_and_prints_target(monkeypatch, capsys):
    calls = _cli_doubles(monkeypatch)

    assert embedding_sync.main(["--all"]) == 1

    out = capsys.readouterr().out
    assert "database=db.local:5433/orbit_dev" in out
    assert "collection=orbit_sessions" in out
    assert "user=ALL sessions=3" in out
    assert "s3cret" not in out
    assert calls == {"count": [None], "reembed": []}


def test_reembed_cli_dry_run_makes_no_embedding_calls(monkeypatch, capsys):
    calls = _cli_doubles(monkeypatch)

    assert embedding_sync.main(["--user-id", "u1", "--dry-run", "--yes"]) == 0

    assert "user=u1 sessions=3" in capsys.readouterr().out
    assert calls == {"count": ["u1"], "reembed": []}


def test_reembed_cli_runs_with_yes(monkeypatch, capsys):
    calls = _cli_doubles(monkeypatch)

    assert embedding_sync.main(["--user-id", "u1", "--yes"]) == 0

    assert "re-embedded 3 sessions" in capsys.readouterr().out
    assert calls == {"count": ["u1"], "reembed": ["u1"]}


def test_retrieval_eval_text_matches_product_text(monkeypatch):
    # 평가 하네스가 제품과 다른 텍스트를 재면 다음 하한 재선정이 옛 텍스트로 측정된다.
    from eval.run_retrieval_eval import _passage_text

    tabs = [{"title": "Preserving and Resetting State – React",
             "url": "https://react.dev/learn/preserving-and-resetting-state"}]
    session = {"title": "React 상태", "overview": "개요", "purpose": "목적", "highlights": ["하나"], "tabs": tabs}
    db = _FakeDB(owner="u1", tabs=tabs)
    texts: list[str] = []

    async def fake_embed(text, model):
        texts.append(text)
        return [0.1]

    async def fake_upsert(*_args):
        pass

    monkeypatch.setattr(embedding_sync, "AsyncSessionLocal", lambda: _SessionCtx(db))
    monkeypatch.setattr(embedding_sync, "embed", fake_embed)
    monkeypatch.setattr(embedding_sync, "upsert_point", fake_upsert)

    asyncio.run(embedding_sync.embed_and_upsert(
        "s1", session["title"], SessionSummary(overview="개요", purpose="목적", highlights=["하나"])
    ))

    assert _passage_text(session) == texts[0]
