import pytest
from pydantic import ValidationError

from app.schemas.event import (
    EventBatchRequest,
    EventIngestResult,
    ExplorationEventIn,
    PendingCountResponse,
)

VALID_UUID = "b3f1c2a0-1111-4a2b-9c3d-000000000001"


def _event(**overrides) -> dict:
    base = {
        "id": VALID_UUID,
        "url": "https://example.com/path",
        "visited_at": "2026-08-03T05:12:00Z",
    }
    base.update(overrides)
    return base


def test_exploration_event_in_requires_valid_uuid_id():
    with pytest.raises(ValidationError):
        ExplorationEventIn(**_event(id="not-a-uuid"))


def test_exploration_event_in_accepts_valid_uuid_id():
    event = ExplorationEventIn(**_event())
    assert event.id == VALID_UUID


def test_exploration_event_in_defaults():
    event = ExplorationEventIn(**_event())
    assert event.active_duration_ms == 0
    assert event.event_type == "visit"
    assert event.content_excerpt == ""
    assert event.source == "browser"
    assert event.ended_at is None
    assert event.tab_id is None
    assert event.window_id is None
    assert event.previous_event_id is None
    assert event.referrer_url is None
    assert event.device_id is None
    assert event.title is None


def test_exploration_event_in_requires_url_and_visited_at():
    with pytest.raises(ValidationError):
        ExplorationEventIn(id=VALID_UUID)


def test_event_batch_request_rejects_empty_events():
    with pytest.raises(ValidationError):
        EventBatchRequest(events=[])


def test_event_batch_request_rejects_over_200_events():
    events = [_event(id=f"b3f1c2a0-1111-4a2b-9c3d-{i:012d}") for i in range(201)]
    with pytest.raises(ValidationError):
        EventBatchRequest(events=events)


def test_event_batch_request_accepts_1_to_200_events():
    events = [_event(id=f"b3f1c2a0-1111-4a2b-9c3d-{i:012d}") for i in range(200)]
    batch = EventBatchRequest(events=events)
    assert len(batch.events) == 200
    assert batch.device_id is None


def test_event_ingest_result_fields():
    result = EventIngestResult(accepted=1, duplicates=2, filtered=3, pending_total=4)
    assert result.model_dump() == {
        "accepted": 1,
        "duplicates": 2,
        "filtered": 3,
        "pending_total": 4,
        "team_accepted": 0,
        "team_downgraded": 0,
        "window_closed": False,
    }


def test_pending_count_response_defaults_last_completed_to_none():
    response = PendingCountResponse(pending=5)
    assert response.last_completed_sync_at is None


# ── 필드 길이 (공용 서버 입력 경계) ─────────────────────────────
# 확장은 실패한 배치를 통째로 재시도한다. 길이 초과를 422로 거르면 이벤트 하나가 큐 전체를 막고,
# VARCHAR를 넘겨 DB에 넣으면 500으로 같은 일이 난다. 그래서 자르고 받는다.


def test_short_identifier_fields_are_cut_to_db_column_width():
    event = ExplorationEventIn(
        **_event(event_type="v" * 50, source="s" * 50, device_id="d" * 100, previous_event_id="p" * 80)
    )
    assert event.event_type == "v" * 20
    assert event.source == "s" * 20
    assert event.device_id == "d" * 64
    assert event.previous_event_id == "p" * 36


def test_batch_device_id_is_cut_to_db_column_width():
    batch = EventBatchRequest(device_id="d" * 100, events=[_event()])
    assert batch.device_id == "d" * 64


def test_urls_are_capped_without_rejecting_the_batch():
    long_url = "https://example.com/?" + "q" * 40000
    event = ExplorationEventIn(**_event(url=long_url, referrer_url=long_url))
    assert len(event.url) == 32768
    assert len(event.referrer_url) == 32768
    assert event.url.startswith("https://example.com/?")


def test_normal_values_are_untouched():
    event = ExplorationEventIn(**_event(device_id="dev-1", previous_event_id=VALID_UUID))
    assert event.url == "https://example.com/path"
    assert event.device_id == "dev-1"
    assert event.previous_event_id == VALID_UUID


def test_oversized_team_marks_are_dropped_but_event_is_kept():
    # 팀 표시는 서버가 어차피 판정해 버린다. 422로 배치를 거르면 이벤트 하나가 큐 전체를 막는다.
    event = ExplorationEventIn(**_event(workspace_id="w" * 37, collect_window_id="c" * 37))
    assert event.workspace_id is None
    assert event.collect_window_id is None
    assert event.url == "https://example.com/path"


def test_team_marks_within_width_are_kept():
    event = ExplorationEventIn(**_event(workspace_id="w" * 36, collect_window_id=VALID_UUID))
    assert event.workspace_id == "w" * 36
    assert event.collect_window_id == VALID_UUID
