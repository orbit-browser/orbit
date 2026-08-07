import pytest
from pydantic import ValidationError

from app.api import folders
from app.schemas.folder import (
    AssignSessionsRequest,
    CreateFolderRequest,
    UpdateFolderRequest,
)


# ── 색 배정 ──────────────────────────────────────────────


def test_default_hue_cycles_through_palette():
    hues = [folders.default_hue(position) for position in range(len(folders._HUE_PALETTE))]
    assert hues == list(folders._HUE_PALETTE)


def test_default_hue_wraps_after_palette_end():
    size = len(folders._HUE_PALETTE)
    assert folders.default_hue(size) == folders._HUE_PALETTE[0]
    assert folders.default_hue(size + 3) == folders._HUE_PALETTE[3]


def test_default_hue_handles_negative_position():
    """position 이 음수로 들어와도 IndexError 없이 팔레트 안에서 돈다."""
    assert folders.default_hue(-1) in folders._HUE_PALETTE


# ── 요청 스키마 경계 ──────────────────────────────────────


def test_folder_name_length_boundary():
    assert CreateFolderRequest(name="a" * 60).name == "a" * 60

    with pytest.raises(ValidationError):
        CreateFolderRequest(name="a" * 61)

    with pytest.raises(ValidationError):
        CreateFolderRequest(name="")


def test_update_folder_allows_partial_fields():
    body = UpdateFolderRequest(name="이름만 변경")
    assert body.name == "이름만 변경"
    assert body.hue is None
    assert body.position is None


def test_update_folder_rejects_negative_position():
    with pytest.raises(ValidationError):
        UpdateFolderRequest(position=-1)


def test_assign_requires_at_least_one_session():
    with pytest.raises(ValidationError):
        AssignSessionsRequest(session_ids=[])


def test_assign_caps_batch_size():
    ids = [str(index) for index in range(200)]
    assert len(AssignSessionsRequest(session_ids=ids).session_ids) == 200

    with pytest.raises(ValidationError):
        AssignSessionsRequest(session_ids=ids + ["overflow"])


# ── 배정 결과 분류 ────────────────────────────────────────


def _split(requested: list[str], owned: set[str]) -> tuple[list[str], list[str]]:
    """folders.assign_sessions 의 분류 규칙 — 중복 제거 후 순서 유지."""
    unique = list(dict.fromkeys(requested))
    return (
        [sid for sid in unique if sid in owned],
        [sid for sid in unique if sid not in owned],
    )


def test_assign_split_keeps_request_order_and_dedupes():
    assigned, skipped = _split(["b", "a", "b", "ghost"], {"a", "b"})
    assert assigned == ["b", "a"]
    assert skipped == ["ghost"]


def test_assign_split_reports_all_unknown_ids():
    assigned, skipped = _split(["x", "y"], set())
    assert assigned == []
    assert skipped == ["x", "y"]
