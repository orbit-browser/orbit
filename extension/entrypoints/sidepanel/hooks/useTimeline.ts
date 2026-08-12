// TimelineView의 이벤트 스트림 훅 — 로컬 IndexedDB(큐)에서 open/pending/synced 이벤트를
// 직접 읽고(SW를 깨우지 않음), synced 이벤트만 서버 GET /events?date=today 결과와 병합해
// 세션 배정 여부를 표시한다. 계약 근거: docs/api-design-v2.md §3, docs/target-architecture.md §7,
// docs/IA.md "타임라인 홈".

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteEvent as deleteLocalEvent, listByStatus } from '../../../lib/events/queue';
import { deleteServerEvent, fetchEventsByDate } from '../../../lib/api';
import type { TodayEvent } from '../../../lib/types';
import { useSyncStatusInvalidation } from './useSyncStatus';

const TIMELINE_QUERY_KEY = ['orbit-timeline'] as const;

export type TimelineBadge =
  | { kind: 'pending' }
  | { kind: 'synced' }
  | { kind: 'excluded' }
  | { kind: 'session'; sessionId: string; title: string };

export interface TimelineEntry {
  id: string;
  url: string;
  title: string;
  domain: string;
  /** ISO 8601 */
  visitedAt: string;
  durationMs: number;
  isSynced: boolean;
  badge: TimelineBadge;
}

export interface TimelineDateGroup {
  dateKey: string;
  label: string;
  entries: TimelineEntry[];
}

function dateKeyOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateLabelOf(iso: string): string {
  const key = dateKeyOf(iso);
  const now = new Date();
  if (key === dateKeyOf(now.toISOString())) return '오늘';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === dateKeyOf(yesterday.toISOString())) return '어제';
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

async function loadTimelineEntries(): Promise<TimelineEntry[]> {
  const [open, pending, synced] = await Promise.all([
    listByStatus('open'),
    listByStatus('pending'),
    listByStatus('synced'),
  ]);

  const unsynced: TimelineEntry[] = [...open, ...pending].map((e) => ({
    id: e.eventId,
    url: e.url,
    title: e.title,
    domain: e.domain,
    visitedAt: e.visitedAt,
    durationMs: e.activeDurationMs,
    isSynced: false,
    badge: { kind: 'pending' },
  }));

  // synced 이벤트의 세션 배정 여부는 서버 조회 성공 시에만 표시하고,
  // 실패(백엔드 미연결 등)하면 "동기화됨"으로 fallback한다(계약 명시 사항).
  // 로컬 큐는 48시간 보관이라 '오늘' 외 날짜도 있을 수 있으므로,
  // synced 이벤트가 걸친 날짜별로 조회한다(최대 3일 캡).
  const serverById = new Map<string, TodayEvent>();
  const dates = [...new Set(synced.map((e) => e.visitedAt.slice(0, 10)))].sort().reverse().slice(0, 3);
  await Promise.all(
    dates.map(async (date) => {
      try {
        const events = await fetchEventsByDate(date);
        for (const ev of events) serverById.set(ev.eventId, ev);
      } catch {
        // no-op — 해당 날짜 이벤트는 'synced' 배지로 처리됨
      }
    }),
  );

  const syncedEntries: TimelineEntry[] = synced.map((e) => {
    const match = serverById.get(e.eventId);
    let badge: TimelineBadge;
    if (match?.sessionId && match.sessionTitle) {
      badge = { kind: 'session', sessionId: match.sessionId, title: match.sessionTitle };
    } else if (match?.excluded) {
      badge = { kind: 'excluded' };
    } else {
      badge = { kind: 'synced' };
    }
    return {
      id: e.eventId,
      url: e.url,
      title: e.title,
      domain: e.domain,
      visitedAt: e.visitedAt,
      durationMs: e.activeDurationMs,
      isSynced: true,
      badge,
    };
  });

  return [...unsynced, ...syncedEntries].sort((a, b) => b.visitedAt.localeCompare(a.visitedAt));
}

/**
 * 로컬 목록을 제목·도메인·URL 문자 일치로 걸러낸다.
 *
 * Ask 는 서버에 저장된 것만 찾으므로 방금 본 페이지(아직 pending)는 잡히지 않는다.
 * "아까 본 거"를 즉시 찾는 경로가 따로 필요해서, 네트워크를 타지 않는 필터를 둔다.
 */
export function filterTimelineEntries(
  entries: TimelineEntry[],
  query: string,
): TimelineEntry[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return entries;
  return entries.filter((entry) =>
    [entry.title, entry.domain, entry.url].some((field) =>
      field.toLowerCase().includes(normalized),
    ),
  );
}

export function useTimeline(query = '') {
  const queryClient = useQueryClient();

  useSyncStatusInvalidation(() => {
    queryClient.invalidateQueries({ queryKey: TIMELINE_QUERY_KEY });
  });

  const timelineQuery = useQuery({
    queryKey: TIMELINE_QUERY_KEY,
    queryFn: loadTimelineEntries,
    // orbit:syncStatus 변경 시 즉시 무효화되지만, 안전망으로 짧은 주기 재조회도 유지한다.
    refetchInterval: 10_000,
  });

  const groups = useMemo<TimelineDateGroup[]>(() => {
    const entries = filterTimelineEntries(timelineQuery.data ?? [], query);
    const byDate = new Map<string, TimelineEntry[]>();
    for (const entry of entries) {
      const key = dateKeyOf(entry.visitedAt);
      const list = byDate.get(key);
      if (list) list.push(entry);
      else byDate.set(key, [entry]);
    }
    return Array.from(byDate.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([dateKey, entries]) => ({
        dateKey,
        label: dateLabelOf(entries[0].visitedAt),
        entries,
      }));
  }, [timelineQuery.data, query]);

  const hasEntries = (timelineQuery.data?.length ?? 0) > 0;

  return {
    groups,
    isLoading: timelineQuery.isLoading,
    isError: timelineQuery.isError,
    /** 필터 결과가 비었을 때 — 기록 자체가 없는 것과 구분해야 안내 문구가 맞다. */
    isFilteredOut: hasEntries && groups.length === 0,
    isEmpty: !timelineQuery.isLoading && !timelineQuery.isError && !hasEntries,
  };
}

async function deleteTimelineEntry(entry: TimelineEntry): Promise<void> {
  if (!entry.isSynced) {
    await deleteLocalEvent(entry.id);
    return;
  }
  try {
    await deleteServerEvent(entry.id);
  } catch (err) {
    // 서버에서 이미 지워진 경우(404)는 로컬 정리만 마저 진행한다. 그 외 오류는 그대로 전파해
    // 호출부(TimelineView)가 실패를 성공처럼 감추지 않고 오류 토스트를 보여주게 한다.
    const isNotFound = err instanceof Error && err.message.includes('404');
    if (!isNotFound) throw err;
  }
  await deleteLocalEvent(entry.id);
}

export function useDeleteTimelineEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteTimelineEntry,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TIMELINE_QUERY_KEY }),
  });
}
