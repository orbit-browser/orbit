import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api import folders, settings as settings_api
from app.services import folder_classifier as fc

FOLDER_OF = {"k1": "k8s", "k2": "k8s", "k3": "k8s", "j1": "job", "j2": "job"}


def test_best_folder_uses_top_two_mean_and_margin():
    match = fc.best_folder({"k1": 0.60, "k2": 0.50, "k3": 0.10, "j1": 0.40, "j2": 0.20, "x": 0.99}, FOLDER_OF)

    assert match.folder_id == "k8s"
    assert match.score == pytest.approx(0.55)
    assert match.margin == pytest.approx(0.55 - 0.30)
    assert match.members == 3
    assert match.similar_session_ids == ["k1", "k2"]


def test_best_folder_single_folder_margin_is_score_and_empty_is_none():
    match = fc.best_folder({"j1": 0.5}, FOLDER_OF)
    assert (match.folder_id, match.score, match.margin, match.members) == ("job", 0.5, 0.5, 1)
    assert fc.best_folder({}, FOLDER_OF) is None
    assert fc.best_folder({"x": 0.9}, FOLDER_OF) is None


def _match(score, margin=0.2, members=3):
    return fc.FolderMatch("k8s", score, margin, members, ["k1"])


def test_decide_auto_only_when_confident():
    assert fc.decide(_match(0.50)) == "auto"
    assert fc.decide(_match(0.46)) == "suggest"  # 점수 부족
    assert fc.decide(_match(0.50, margin=0.05)) == "suggest"  # 2위 폴더와 가까움
    assert fc.decide(_match(0.50, members=1)) == "suggest"  # 근거 세션 1개
    assert fc.decide(_match(0.37)) is None
    assert fc.decide(None) is None


class _FakeDB:
    def __init__(self, sessions=None):
        self.sessions = {session.id: session for session in sessions or []}
        self.committed = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def execute(self, _stmt):
        rows = list(self.sessions.values())
        return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: rows))

    async def get(self, _model, session_id):
        return self.sessions.get(session_id)

    async def commit(self):
        self.committed += 1


def _session(session_id, **fields):
    return SimpleNamespace(
        id=session_id, user_id="u1", status="active", folder_id=None, folder_assigned_by=None, **fields
    )


def test_auto_file_sessions_files_only_confident_matches(monkeypatch):
    sure, unsure = _session("new-sure"), _session("new-unsure")
    db = _FakeDB([sure, unsure])
    vectors = {"new-sure": [1.0], "new-unsure": [0.0]}
    scores = {
        "new-sure": {"k1": 0.60, "k2": 0.55, "j1": 0.30},
        "new-unsure": {"k1": 0.50, "k2": 0.45, "j1": 0.44, "j2": 0.43},
    }

    async def evidence(_db, _user_id):
        return FOLDER_OF

    async def get_vector(session_id):
        return vectors[session_id]

    async def score_sessions(vector, ids, *, user_id):
        assert user_id == "u1" and set(ids) == set(FOLDER_OF)
        return scores["new-sure" if vector == [1.0] else "new-unsure"]

    monkeypatch.setattr(fc, "AsyncSessionLocal", lambda: db)
    monkeypatch.setattr(fc, "_evidence", evidence)
    monkeypatch.setattr(fc, "get_vector", get_vector)
    monkeypatch.setattr(fc, "score_sessions", score_sessions)

    assert asyncio.run(fc.auto_file_sessions("u1", {"new-sure", "new-unsure"})) == 1
    assert (sure.folder_id, sure.folder_assigned_by) == ("k8s", "auto")
    assert (unsure.folder_id, unsure.folder_assigned_by) == (None, None)
    assert db.committed == 1


def test_auto_file_sessions_skips_without_evidence_and_survives_errors(monkeypatch):
    async def no_evidence(_db, _user_id):
        return {}

    async def broken(_db, _user_id):
        raise RuntimeError("db down")

    monkeypatch.setattr(fc, "AsyncSessionLocal", lambda: _FakeDB())
    monkeypatch.setattr(fc, "_evidence", no_evidence)
    assert asyncio.run(fc.auto_file_sessions("u1", {"s1"})) == 0
    assert asyncio.run(fc.auto_file_sessions("u1", set())) == 0
    monkeypatch.setattr(fc, "_evidence", broken)
    assert asyncio.run(fc.auto_file_sessions("u1", {"s1"})) == 0


def test_dismiss_marks_user_decision_and_hides_foreign_sessions():
    mine, foreign, merged = _session("s1"), _session("s2"), _session("s3")
    foreign.user_id = "other"
    merged.status = "merged"
    db = _FakeDB([mine, foreign, merged])

    asyncio.run(folders.dismiss_suggestion("s1", db=db, user_id="u1"))
    assert (mine.folder_id, mine.folder_assigned_by) == (None, "user")

    for session_id in ("s2", "s3", "missing"):
        with pytest.raises(HTTPException) as exc:
            asyncio.run(folders.dismiss_suggestion(session_id, db=db, user_id="u1"))
        assert exc.value.status_code == 404


def test_removing_auto_filed_session_marks_user_decision(monkeypatch):
    session = _session("s1")
    session.folder_id, session.folder_assigned_by = "k8s", "auto"
    db = _FakeDB([session])

    async def owned(_db, folder_id, _user_id):
        return SimpleNamespace(id=folder_id)

    monkeypatch.setattr(folders, "_owned_folder", owned)
    asyncio.run(folders.remove_session("k8s", "s1", db=db, user_id="u1"))
    assert (session.folder_id, session.folder_assigned_by) == (None, "user")


def test_suggestions_endpoint_maps_matches_and_reports_vector_failure(monkeypatch):
    async def suggestions(_db, _user_id):
        return [("s1", fc.FolderMatch("k8s", 0.43219, 0.1, 3, ["k1", "k2"]))]

    monkeypatch.setattr(folders, "folder_suggestions", suggestions)
    result = asyncio.run(folders.list_suggestions(db=None, user_id="u1"))
    assert [item.model_dump() for item in result] == [
        {"session_id": "s1", "folder_id": "k8s", "score": 0.4322, "similar_session_ids": ["k1", "k2"]}
    ]

    async def down(_db, _user_id):
        raise RuntimeError("qdrant down")

    monkeypatch.setattr(folders, "folder_suggestions", down)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(folders.list_suggestions(db=None, user_id="u1"))
    assert exc.value.status_code == 503


def test_settings_expose_and_update_auto_folder(monkeypatch):
    store: dict[str, bool] = {}

    async def get_bool(_db, key, default):
        return store.get(key, default)

    async def set_bool(_db, key, value):
        store[key] = value

    monkeypatch.setattr(settings_api, "get_bool", get_bool)
    monkeypatch.setattr(settings_api, "set_bool", set_bool)

    assert asyncio.run(settings_api.get_settings(db=None)).auto_folder_enabled is True
    body = settings_api.UpdateSettingsRequest(auto_folder_enabled=False)
    updated = asyncio.run(settings_api.update_settings(body, db=None))
    assert updated.auto_folder_enabled is False
    assert updated.auto_merge_enabled is False
