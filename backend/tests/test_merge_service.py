import asyncio
from types import SimpleNamespace

import pytest

from app.services import merge_service
from app.services.merge_service import (
    MergeError,
    _title_jaccard,
    _union_keywords,
    is_auto_merge_candidate,
)


# ── 순수 함수 ──────────────────────────────────────────────


def test_union_keywords_preserves_order_and_dedupes():
    assert _union_keywords(["제주", "항공권"], ["항공권", "예약"]) == ["제주", "항공권", "예약"]


def test_union_keywords_handles_none():
    assert _union_keywords(None, None) == []
    assert _union_keywords(None, ["a"]) == ["a"]


# ── 자동 병합 후보 판정 (opt-in, 명백한 중복만) ─────────────


def test_title_jaccard_identical_titles_is_one():
    assert _title_jaccard("가비아 결제 및 로그인 확인", "가비아 결제 및 로그인 확인") == 1.0


def test_title_jaccard_disjoint_titles_is_zero():
    assert _title_jaccard("제주 항공권", "리액트 훅") == 0.0


def test_auto_merge_candidate_requires_high_score_and_near_identical_title():
    # 코사인·제목 둘 다 충족 → 명백한 중복
    assert is_auto_merge_candidate(
        0.85, "가비아 결제 및 로그인 확인", "가비아 결제 및 로그인 확인",
        floor=0.85, title_jaccard=0.8,
    ) is True


def test_auto_merge_candidate_rejects_below_floor():
    assert is_auto_merge_candidate(
        0.84, "가비아 결제", "가비아 결제", floor=0.85, title_jaccard=0.8,
    ) is False


def test_auto_merge_candidate_rejects_high_score_but_different_title():
    # 제주항공권 검색↔예약: 유사도는 높아도 제목이 달라 자동 대상 아님(수동 유지)
    assert is_auto_merge_candidate(
        0.90, "제주도 항공권 검색", "제주 항공권 예약", floor=0.85, title_jaccard=0.8,
    ) is False


# ── fake DB + 게이트웨이 patch ─────────────────────────────


class _FakeDB:
    def __init__(self, sessions: dict):
        self._sessions = sessions
        self.committed = False

    async def get(self, _model, id_):
        return self._sessions.get(id_)

    async def commit(self):
        self.committed = True

    async def refresh(self, _obj):
        pass


def _session(id_, *, status="active", keywords=None, merged_into=None):
    return SimpleNamespace(
        id=id_,
        status=status,
        keywords=keywords or [],
        merged_into=merged_into,
        event_count=0,
        summary_status="done",
        updated_at=None,
        started_at=None,
        last_activity_at=None,
        total_active_duration_ms=0,
    )


def _patch_gateways(monkeypatch, *, absorbed_events=None, survivor_existing=None,
                    next_seq=0, restore_events=None):
    calls = {"move": [], "delete": [], "recompute": []}

    async def fake_fetch_ordered(_db, session_id, *, merged_from=None):
        if merged_from is not None:
            return list(restore_events or [])
        return list(absorbed_events or [])

    async def fake_existing(_db, _session_id):
        return set(survivor_existing or set())

    async def fake_next_seq(_db, _session_id):
        return next_seq

    async def fake_move(_db, event_id, from_session, to_session, sequence_order, merged_from):
        calls["move"].append((event_id, from_session, to_session, sequence_order, merged_from))

    async def fake_delete(_db, session_id, event_id):
        calls["delete"].append((session_id, event_id))

    async def fake_recompute(_db, session):
        calls["recompute"].append(session.id)

    monkeypatch.setattr(merge_service, "_fetch_events_ordered", fake_fetch_ordered)
    monkeypatch.setattr(merge_service, "_existing_event_ids", fake_existing)
    monkeypatch.setattr(merge_service, "_next_sequence_order", fake_next_seq)
    monkeypatch.setattr(merge_service, "_move_event", fake_move)
    monkeypatch.setattr(merge_service, "_delete_event", fake_delete)
    monkeypatch.setattr(merge_service, "_recompute_session_stats", fake_recompute)
    return calls


# ── merge 검증 분기 ──────────────────────────────────────


def test_merge_same_id_is_invalid(monkeypatch):
    _patch_gateways(monkeypatch)
    db = _FakeDB({"a": _session("a")})
    with pytest.raises(MergeError) as exc:
        asyncio.run(merge_service.merge_sessions(db, "a", "a"))
    assert exc.value.code == "invalid"


def test_merge_missing_session_is_not_found(monkeypatch):
    _patch_gateways(monkeypatch)
    db = _FakeDB({"a": _session("a")})
    with pytest.raises(MergeError) as exc:
        asyncio.run(merge_service.merge_sessions(db, "a", "missing"))
    assert exc.value.code == "not_found"


def test_merge_non_active_is_conflict(monkeypatch):
    _patch_gateways(monkeypatch)
    db = _FakeDB({"a": _session("a"), "b": _session("b", status="merged")})
    with pytest.raises(MergeError) as exc:
        asyncio.run(merge_service.merge_sessions(db, "a", "b"))
    assert exc.value.code == "conflict"


# ── merge 정상 경로 ──────────────────────────────────────


def test_merge_moves_events_and_marks_absorbed(monkeypatch):
    calls = _patch_gateways(
        monkeypatch,
        absorbed_events=["e1", "e2", "e3"],
        survivor_existing={"e2"},  # e2는 survivor에 이미 있음 → dedup 삭제
        next_seq=5,
    )
    a = _session("a", keywords=["제주"])
    b = _session("b", keywords=["항공권", "제주"])
    db = _FakeDB({"a": a, "b": b})

    result = asyncio.run(merge_service.merge_sessions(db, "a", "b"))

    # e1, e3만 이전(순서·sequence_order=5,6), e2는 삭제
    assert calls["move"] == [
        ("e1", "b", "a", 5, "b"),
        ("e3", "b", "a", 6, "b"),
    ]
    assert calls["delete"] == [("b", "e2")]
    assert "a" in calls["recompute"]
    # keywords 합집합(순서 보존)
    assert result.keywords == ["제주", "항공권"]
    assert result.summary_status == "pending"
    # absorbed soft-delete
    assert b.status == "merged"
    assert b.merged_into == "a"
    assert b.event_count == 0
    assert db.committed is True


# ── unmerge 검증 분기 ────────────────────────────────────


def test_unmerge_missing_is_not_found(monkeypatch):
    _patch_gateways(monkeypatch)
    db = _FakeDB({"a": _session("a")})
    with pytest.raises(MergeError) as exc:
        asyncio.run(merge_service.unmerge_sessions(db, "a", "missing"))
    assert exc.value.code == "not_found"


def test_unmerge_not_merged_into_survivor_is_invalid(monkeypatch):
    _patch_gateways(monkeypatch)
    # b는 merged지만 다른 세션(c)으로 병합됨 → a로 unmerge 불가
    db = _FakeDB({"a": _session("a"), "b": _session("b", status="merged", merged_into="c")})
    with pytest.raises(MergeError) as exc:
        asyncio.run(merge_service.unmerge_sessions(db, "a", "b"))
    assert exc.value.code == "invalid"


def test_unmerge_no_restore_events_is_invalid(monkeypatch):
    _patch_gateways(monkeypatch, restore_events=[])
    db = _FakeDB({"a": _session("a"), "b": _session("b", status="merged", merged_into="a")})
    with pytest.raises(MergeError) as exc:
        asyncio.run(merge_service.unmerge_sessions(db, "a", "b"))
    assert exc.value.code == "invalid"


# ── unmerge 정상 경로 ────────────────────────────────────


def test_unmerge_restores_events_and_reactivates(monkeypatch):
    calls = _patch_gateways(monkeypatch, restore_events=["e1", "e3"])
    a = _session("a")
    b = _session("b", status="merged", merged_into="a")
    db = _FakeDB({"a": a, "b": b})

    survivor, absorbed = asyncio.run(merge_service.unmerge_sessions(db, "a", "b"))

    # merged_from 태그 행을 b로 복원(sequence_order 0,1, 태그 제거)
    assert calls["move"] == [
        ("e1", "a", "b", 0, None),
        ("e3", "a", "b", 1, None),
    ]
    assert set(calls["recompute"]) == {"a", "b"}
    assert absorbed.status == "active"
    assert absorbed.merged_into is None
    assert survivor.summary_status == "pending"
    assert absorbed.summary_status == "pending"
    assert db.committed is True
