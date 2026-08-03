from datetime import datetime, timedelta, timezone

from app.services.grouper import dedupe_events, group_by_time_gap

_BASE = datetime(2026, 8, 3, 5, 0, tzinfo=timezone.utc)


def _event(
    id_: str,
    *,
    minutes: int = 0,
    normalized_url: str = "https://example.com/a",
    content_hash: str = "",
    active_duration_ms: int = 1000,
    content_excerpt: str = "",
) -> dict:
    return {
        "id": id_,
        "normalized_url": normalized_url,
        "content_hash": content_hash,
        "visited_at": _BASE + timedelta(minutes=minutes),
        "active_duration_ms": active_duration_ms,
        "content_excerpt": content_excerpt,
    }


# ── dedupe_events ──────────────────────────────────────────────


def test_dedupe_keeps_single_event_untouched():
    events = [_event("a", normalized_url="https://x.com")]
    kept, discarded = dedupe_events(events)
    assert kept == events
    assert discarded == []


def test_dedupe_merges_same_normalized_url():
    events = [
        _event("a", minutes=0, normalized_url="https://x.com", active_duration_ms=1000, content_excerpt="short"),
        _event("b", minutes=5, normalized_url="https://x.com", active_duration_ms=2000, content_excerpt="a much longer excerpt"),
    ]
    kept, discarded = dedupe_events(events)

    assert len(kept) == 1
    assert discarded == ["b"]
    merged = kept[0]
    assert merged["id"] == "a"  # 최초 방문 이벤트가 대표
    assert merged["active_duration_ms"] == 3000  # 합산
    assert merged["content_excerpt"] == "a much longer excerpt"  # 가장 긴 것


def test_dedupe_merges_same_content_hash_when_nonempty():
    events = [
        _event("a", minutes=0, normalized_url="https://x.com/1", content_hash="hash1"),
        _event("b", minutes=1, normalized_url="https://x.com/2", content_hash="hash1"),
    ]
    kept, discarded = dedupe_events(events)
    assert len(kept) == 1
    assert discarded == ["b"]


def test_dedupe_does_not_merge_on_empty_content_hash():
    events = [
        _event("a", minutes=0, normalized_url="https://x.com/1", content_hash=""),
        _event("b", minutes=1, normalized_url="https://x.com/2", content_hash=""),
    ]
    kept, discarded = dedupe_events(events)
    assert len(kept) == 2
    assert discarded == []


def test_dedupe_transitively_merges_via_different_keys():
    # a-b는 normalized_url로, b-c는 content_hash로 연결 → a,b,c 모두 한 그룹
    events = [
        _event("a", minutes=0, normalized_url="https://shared.com", content_hash=""),
        _event("b", minutes=1, normalized_url="https://shared.com", content_hash="hashX"),
        _event("c", minutes=2, normalized_url="https://other.com", content_hash="hashX"),
    ]
    kept, discarded = dedupe_events(events)
    assert len(kept) == 1
    assert kept[0]["id"] == "a"
    assert set(discarded) == {"b", "c"}


def test_dedupe_preserves_unrelated_events_independently():
    events = [
        _event("a", normalized_url="https://one.com"),
        _event("b", normalized_url="https://two.com"),
    ]
    kept, discarded = dedupe_events(events)
    assert {e["id"] for e in kept} == {"a", "b"}
    assert discarded == []


# ── group_by_time_gap ──────────────────────────────────────────────


def test_group_by_time_gap_empty_events_returns_empty_list():
    assert group_by_time_gap([]) == []


def test_group_by_time_gap_within_gap_stays_one_group():
    events = [_event("a", minutes=0), _event("b", minutes=10), _event("c", minutes=25)]
    groups = group_by_time_gap(events, gap_minutes=30)
    assert len(groups) == 1
    assert [e["id"] for e in groups[0]] == ["a", "b", "c"]


def test_group_by_time_gap_splits_on_gap_exceeded():
    events = [_event("a", minutes=0), _event("b", minutes=10), _event("c", minutes=100)]
    groups = group_by_time_gap(events, gap_minutes=30)
    assert len(groups) == 2
    assert [e["id"] for e in groups[0]] == ["a", "b"]
    assert [e["id"] for e in groups[1]] == ["c"]


def test_group_by_time_gap_sorts_unsorted_input_by_visited_at():
    events = [_event("b", minutes=10), _event("a", minutes=0)]
    groups = group_by_time_gap(events, gap_minutes=30)
    assert len(groups) == 1
    assert [e["id"] for e in groups[0]] == ["a", "b"]


def test_group_by_time_gap_splits_oversized_group_preserving_order():
    events = [_event(str(i), minutes=i) for i in range(7)]
    groups = group_by_time_gap(events, gap_minutes=30, max_group_size=3)
    assert len(groups) == 3
    assert [e["id"] for e in groups[0]] == ["0", "1", "2"]
    assert [e["id"] for e in groups[1]] == ["3", "4", "5"]
    assert [e["id"] for e in groups[2]] == ["6"]


def test_group_by_time_gap_exact_boundary_is_not_split():
    events = [_event("a", minutes=0), _event("b", minutes=30)]
    groups = group_by_time_gap(events, gap_minutes=30)
    # gap == 정확히 30분이면 초과가 아니므로 같은 그룹
    assert len(groups) == 1


def test_group_by_time_gap_just_over_boundary_splits():
    events = [_event("a", minutes=0), _event("b", minutes=31)]
    groups = group_by_time_gap(events, gap_minutes=30)
    assert len(groups) == 2
