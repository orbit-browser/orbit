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
    }


def test_pending_count_response_defaults_last_completed_to_none():
    response = PendingCountResponse(pending=5)
    assert response.last_completed_sync_at is None
