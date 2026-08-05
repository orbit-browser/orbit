"""배치 세션화 전처리 — 중복 병합 + 시간 간격 그룹화 (순수 함수, DB 접근 없음).

docs/target-architecture.md §1, docs/data-model-v2.md §8 근거. sync_pipeline.py가
claim한 이벤트(dict 목록)를 이 모듈로 전처리한 뒤 intent_analyzer에 넘긴다.
"""

from datetime import timedelta


def dedupe_events(events: list[dict]) -> tuple[list[dict], list[str]]:
    """같은 batch 내 normalized_url 또는 content_hash가 같은 이벤트를 병합한다.

    두 기준(normalized_url, content_hash)은 서로 다른 이벤트 쌍을 묶을 수 있어
    전이적으로(transitively) 합쳐질 수 있으므로 union-find로 연결 요소를 구한다.
    병합된 그룹에서는 최초 방문 시각을 유지하고, active_duration_ms는 합산하며,
    content_excerpt는 가장 긴 것을 남긴다.

    Returns:
        (kept, discarded_ids) — kept: 병합 후 대표 이벤트 목록,
        discarded_ids: kept에 흡수되어 제외된 이벤트 id 목록.
    """
    n = len(events)
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    by_url: dict[str, int] = {}
    by_hash: dict[str, int] = {}
    for i, event in enumerate(events):
        url = event.get("normalized_url")
        if url:
            if url in by_url:
                union(by_url[url], i)
            else:
                by_url[url] = i

        content_hash = event.get("content_hash")
        if content_hash:
            if content_hash in by_hash:
                union(by_hash[content_hash], i)
            else:
                by_hash[content_hash] = i

    groups: dict[int, list[int]] = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)

    kept: list[dict] = []
    discarded_ids: list[str] = []

    # 그룹 등장 순서(최초 인덱스 기준)를 보존해 결과가 결정적이게 한다.
    for _root, indices in sorted(groups.items(), key=lambda kv: min(kv[1])):
        group_events = [events[i] for i in indices]
        if len(group_events) == 1:
            kept.append(group_events[0])
            continue

        sorted_group = sorted(group_events, key=lambda e: e["visited_at"])
        merged = dict(sorted_group[0])  # 최초 방문 이벤트를 대표로 유지
        merged["active_duration_ms"] = sum(
            e.get("active_duration_ms") or 0 for e in group_events
        )
        merged["content_excerpt"] = max(
            (e.get("content_excerpt") or "" for e in group_events), key=len
        )
        kept.append(merged)
        discarded_ids.extend(e["id"] for e in sorted_group[1:])

    return kept, discarded_ids


def group_by_time_gap(
    events: list[dict],
    gap_minutes: int = 30,
    max_group_size: int = 25,
) -> list[list[dict]]:
    """visited_at 기준 정렬 후 gap_minutes 초과 간격에서 그룹을 분할한다.

    max_group_size를 넘는 그룹은 방문 순서를 유지한 채 청크로 재분할한다.
    """
    if not events:
        return []

    sorted_events = sorted(events, key=lambda e: e["visited_at"])
    gap = timedelta(minutes=gap_minutes)

    raw_groups: list[list[dict]] = [[sorted_events[0]]]
    for prev, curr in zip(sorted_events, sorted_events[1:]):
        if curr["visited_at"] - prev["visited_at"] > gap:
            raw_groups.append([curr])
        else:
            raw_groups[-1].append(curr)

    result: list[list[dict]] = []
    for group in raw_groups:
        for i in range(0, len(group), max_group_size):
            result.append(group[i : i + max_group_size])
    return result
