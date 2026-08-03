from app.api.events import _build_event_rows
from app.schemas.event import ExplorationEventIn

VALID_UUID_1 = "b3f1c2a0-1111-4a2b-9c3d-000000000001"
VALID_UUID_2 = "b3f1c2a0-1111-4a2b-9c3d-000000000002"
VALID_UUID_3 = "b3f1c2a0-1111-4a2b-9c3d-000000000003"


def _event(**overrides) -> ExplorationEventIn:
    base = {
        "id": VALID_UUID_1,
        "url": "https://www.google.com/search?q=rtx+5070+review",
        "title": "rtx 5070 review - Google 검색",
        "visited_at": "2026-08-03T05:12:00Z",
    }
    base.update(overrides)
    return ExplorationEventIn(**base)


def test_system_url_is_filtered_and_not_stored():
    events = [_event(url="chrome://extensions")]
    rows, filtered = _build_event_rows(events, batch_device_id=None)
    assert rows == []
    assert filtered == 1


def test_non_system_url_is_stored_and_not_filtered():
    events = [_event()]
    rows, filtered = _build_event_rows(events, batch_device_id=None)
    assert len(rows) == 1
    assert filtered == 0


def test_filtered_count_only_counts_system_urls():
    events = [
        _event(id=VALID_UUID_1, url="chrome://newtab"),
        _event(id=VALID_UUID_2),
        _event(id=VALID_UUID_3, url="about:blank"),
    ]
    rows, filtered = _build_event_rows(events, batch_device_id=None)
    assert filtered == 2
    assert len(rows) == 1
    assert rows[0]["id"] == VALID_UUID_2


def test_sensitive_url_clears_content_excerpt_but_keeps_event():
    events = [
        _event(
            url="https://www.kbstar.com/main",
            content_excerpt="account balance details",
        )
    ]
    rows, filtered = _build_event_rows(events, batch_device_id=None)
    assert filtered == 0
    assert len(rows) == 1
    assert rows[0]["content_excerpt"] == ""
    assert rows[0]["content_hash"] == ""


def test_non_sensitive_url_keeps_content_excerpt_and_hash():
    from app.services.event_filter import content_hash

    events = [_event(content_excerpt="some article body")]
    rows, _ = _build_event_rows(events, batch_device_id=None)
    assert rows[0]["content_excerpt"] == "some article body"
    assert rows[0]["content_hash"] == content_hash("some article body")


def test_content_excerpt_is_capped_at_5000_chars():
    long_text = "a" * 6000
    events = [_event(content_excerpt=long_text)]
    rows, _ = _build_event_rows(events, batch_device_id=None)
    assert len(rows[0]["content_excerpt"]) == 5000
    assert rows[0]["content_excerpt"] == "a" * 5000


def test_title_is_capped_at_500_chars():
    long_title = "t" * 600
    events = [_event(title=long_title)]
    rows, _ = _build_event_rows(events, batch_device_id=None)
    assert len(rows[0]["title"]) == 500


def test_empty_title_becomes_none():
    events = [_event(title="")]
    rows, _ = _build_event_rows(events, batch_device_id=None)
    assert rows[0]["title"] is None


def test_device_id_prefers_event_level_over_batch_level():
    events = [_event(device_id="event-device")]
    rows, _ = _build_event_rows(events, batch_device_id="batch-device")
    assert rows[0]["device_id"] == "event-device"


def test_device_id_falls_back_to_batch_level():
    events = [_event(device_id=None)]
    rows, _ = _build_event_rows(events, batch_device_id="batch-device")
    assert rows[0]["device_id"] == "batch-device"


def test_normalized_url_domain_and_search_query_are_computed():
    events = [_event(url="https://www.google.com/search?utm_source=x&q=rtx+5070+review")]
    rows, _ = _build_event_rows(events, batch_device_id=None)
    row = rows[0]
    assert row["domain"] == "www.google.com"
    assert row["search_query"] == "rtx 5070 review"
    assert row["normalized_url"] == "https://www.google.com/search?q=rtx+5070+review"


def test_non_search_url_has_no_search_query():
    events = [_event(url="https://example.com/article/1")]
    rows, _ = _build_event_rows(events, batch_device_id=None)
    assert rows[0]["search_query"] is None
