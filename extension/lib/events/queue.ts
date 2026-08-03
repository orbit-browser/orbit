// 로컬 Persistent Queue — 이벤트 상태 기계(open→pending→syncing→synced)와
// orbit:syncStatus 요약(사이드패널 구독용)을 관리한다.
// 계약 근거: docs/target-architecture.md §2.1, §3

import { getDB, EVENTS_STORE } from './db';
import type { EventStatus, ExplorationEvent, NewEventInput } from './types';
import { MAX_CONTENT_EXCERPT_LENGTH } from './types';

const SYNC_STATUS_KEY = 'orbit:syncStatus';
const QUEUE_LIMIT = 5000;
const PRUNE_AFTER_MS = 48 * 60 * 60 * 1000;
const BACKOFF_CAP_MIN = 30;

export interface SyncStatusSummary {
  pendingCount: number;
  todayCount: number;
  lastSyncAt: string | null;
  lastError: string | null;
  droppedCount: number;
}

type PendingChangeListener = (pendingCount: number) => void;
let pendingChangeListener: PendingChangeListener | null = null;

/** sync/triggers.ts가 개수 트리거(pending ≥ countThreshold)를 구독하는 훅. */
export function setPendingChangeListener(listener: PendingChangeListener | null): void {
  pendingChangeListener = listener;
}

async function writeSyncStatusSummary(
  patch: Partial<Pick<SyncStatusSummary, 'lastSyncAt' | 'lastError'>> = {},
  additionalDropped = 0,
): Promise<void> {
  const { todayCount, pendingCount } = await counts();
  const stored = await chrome.storage.local.get(SYNC_STATUS_KEY);
  const prev = (stored[SYNC_STATUS_KEY] as Partial<SyncStatusSummary> | undefined) ?? {};
  const next: SyncStatusSummary = {
    pendingCount,
    todayCount,
    lastSyncAt: patch.lastSyncAt !== undefined ? patch.lastSyncAt : (prev.lastSyncAt ?? null),
    lastError: patch.lastError !== undefined ? patch.lastError : (prev.lastError ?? null),
    droppedCount: (prev.droppedCount ?? 0) + additionalDropped,
  };
  await chrome.storage.local.set({ [SYNC_STATUS_KEY]: next });
  pendingChangeListener?.(pendingCount);
}

/** sync/engine.ts가 배치 성공/실패 후 lastSyncAt·lastError를 기록할 때 쓴다. */
export function updateSyncStatus(
  patch: Partial<Pick<SyncStatusSummary, 'lastSyncAt' | 'lastError'>>,
): Promise<void> {
  return writeSyncStatusSummary(patch);
}

/** GET_SYNC_STATUS 메시지(사이드패널 폴백)가 읽는 현재 요약. */
export async function getSyncStatus(): Promise<SyncStatusSummary> {
  const stored = await chrome.storage.local.get(SYNC_STATUS_KEY);
  const saved = stored[SYNC_STATUS_KEY] as Partial<SyncStatusSummary> | undefined;
  return {
    pendingCount: saved?.pendingCount ?? 0,
    todayCount: saved?.todayCount ?? 0,
    lastSyncAt: saved?.lastSyncAt ?? null,
    lastError: saved?.lastError ?? null,
    droppedCount: saved?.droppedCount ?? 0,
  };
}

export async function counts(): Promise<{ todayCount: number; pendingCount: number }> {
  const db = await getDB();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const range = IDBKeyRange.lowerBound(startOfToday.toISOString());
  const [todayCount, pendingCount] = await Promise.all([
    db.countFromIndex(EVENTS_STORE, 'by-visitedAt', range),
    db.countFromIndex(EVENTS_STORE, 'by-status', 'pending'),
  ]);
  return { todayCount, pendingCount };
}

export async function addEvent(input: NewEventInput): Promise<ExplorationEvent> {
  const event: ExplorationEvent = {
    ...input,
    status: 'open',
    failureCount: 0,
    nextAttemptAt: null,
    syncedAt: null,
    syncingStartedAt: null,
    createdAt: new Date().toISOString(),
  };
  const db = await getDB();
  await db.put(EVENTS_STORE, event);
  await writeSyncStatusSummary();
  return event;
}

export async function getEvent(eventId: string): Promise<ExplorationEvent | undefined> {
  const db = await getDB();
  return db.get(EVENTS_STORE, eventId);
}

/** onCommitted의 짧은 리다이렉트 치환용 — open 상태일 때만 URL/domain을 제자리에서 교체한다. */
export async function replaceEventUrl(
  eventId: string,
  newUrl: string,
  domain: string,
): Promise<boolean> {
  const db = await getDB();
  const event = await db.get(EVENTS_STORE, eventId);
  if (!event || event.status !== 'open') return false;
  event.url = newUrl;
  event.domain = domain;
  await db.put(EVENTS_STORE, event);
  return true;
}

/** tabs.onUpdated(title 변경) 보강용 — open 상태일 때만 반영한다. */
export async function updateEventTitle(eventId: string, title: string): Promise<void> {
  const db = await getDB();
  const event = await db.get(EVENTS_STORE, eventId);
  if (!event || event.status !== 'open') return;
  event.title = title;
  await db.put(EVENTS_STORE, event);
}

export async function attachContent(eventId: string, excerpt: string): Promise<void> {
  const db = await getDB();
  const event = await db.get(EVENTS_STORE, eventId);
  if (!event) return;
  event.contentExcerpt = excerpt.slice(0, MAX_CONTENT_EXCERPT_LENGTH);
  await db.put(EVENTS_STORE, event);
  await writeSyncStatusSummary();
}

export async function addDwell(eventId: string, ms: number): Promise<void> {
  if (ms <= 0) return;
  const db = await getDB();
  const event = await db.get(EVENTS_STORE, eventId);
  if (!event) return;
  event.activeDurationMs += ms;
  await db.put(EVENTS_STORE, event);
  await writeSyncStatusSummary();
}

export async function finalizeOpenEvent(eventId: string, endedAt: string): Promise<void> {
  const db = await getDB();
  const event = await db.get(EVENTS_STORE, eventId);
  if (!event || event.status !== 'open') return;
  event.endedAt = endedAt;
  event.status = 'pending';
  await db.put(EVENTS_STORE, event);
  await writeSyncStatusSummary();
}

export async function finalizeAllOpen(): Promise<void> {
  const db = await getDB();
  const openEvents = await db.getAllFromIndex(EVENTS_STORE, 'by-status', 'open');
  if (openEvents.length === 0) return;
  const now = new Date().toISOString();
  const tx = db.transaction(EVENTS_STORE, 'readwrite');
  for (const event of openEvents) {
    event.endedAt = event.endedAt ?? now;
    event.status = 'pending';
    await tx.store.put(event);
  }
  await tx.done;
  await writeSyncStatusSummary();
}

export async function listByStatus(status: EventStatus): Promise<ExplorationEvent[]> {
  const db = await getDB();
  return db.getAllFromIndex(EVENTS_STORE, 'by-status', status);
}

/** pending → syncing 전환 + nextAttemptAt이 지난 것만 최대 limit개 claim한다(오래된 순). */
export async function claimPending(limit: number): Promise<ExplorationEvent[]> {
  const db = await getDB();
  const now = Date.now();
  const tx = db.transaction(EVENTS_STORE, 'readwrite');
  const index = tx.store.index('by-status');
  const candidates = await index.getAll('pending');
  const eligible = candidates
    .filter((e) => !e.nextAttemptAt || new Date(e.nextAttemptAt).getTime() <= now)
    .sort((a, b) => a.visitedAt.localeCompare(b.visitedAt))
    .slice(0, limit);

  const claimedAt = new Date().toISOString();
  for (const event of eligible) {
    event.status = 'syncing';
    event.syncingStartedAt = claimedAt;
    await tx.store.put(event);
  }
  await tx.done;
  if (eligible.length) await writeSyncStatusSummary();
  return eligible;
}

export async function markSynced(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDB();
  const tx = db.transaction(EVENTS_STORE, 'readwrite');
  const now = new Date().toISOString();
  for (const id of ids) {
    const event = await tx.store.get(id);
    if (!event) continue;
    event.status = 'synced';
    event.syncedAt = now;
    event.syncingStartedAt = null;
    await tx.store.put(event);
  }
  await tx.done;
  await writeSyncStatusSummary();
}

/**
 * syncing → pending으로 되돌린다. backoff:true면 failureCount를 올리고
 * nextAttemptAt = now + min(2^failureCount, 30)분으로 백오프를 적용한다.
 * 갱신된 이벤트를 반환해 호출부(sync/engine.ts)가 재시도 알람 지연시간을 계산할 수 있게 한다.
 */
export async function releaseToPending(
  ids: string[],
  opts: { backoff: boolean },
): Promise<ExplorationEvent[]> {
  if (ids.length === 0) return [];
  const db = await getDB();
  const tx = db.transaction(EVENTS_STORE, 'readwrite');
  const updated: ExplorationEvent[] = [];
  for (const id of ids) {
    const event = await tx.store.get(id);
    if (!event) continue;
    if (opts.backoff) {
      event.failureCount += 1;
      const minutes = Math.min(2 ** event.failureCount, BACKOFF_CAP_MIN);
      event.nextAttemptAt = new Date(Date.now() + minutes * 60_000).toISOString();
    } else {
      event.nextAttemptAt = null;
    }
    event.status = 'pending';
    event.syncingStartedAt = null;
    await tx.store.put(event);
    updated.push(event);
  }
  await tx.done;
  await writeSyncStatusSummary();
  return updated;
}

export async function deleteEvent(eventId: string): Promise<void> {
  const db = await getDB();
  await db.delete(EVENTS_STORE, eventId);
  await writeSyncStatusSummary();
}

/** SW 시작 시 호출 — 이전 인스턴스가 죽어 syncing에 고아로 남은 이벤트를 pending으로 되돌린다. */
export async function resetStaleSyncing(olderThanMs: number): Promise<number> {
  const db = await getDB();
  const tx = db.transaction(EVENTS_STORE, 'readwrite');
  const index = tx.store.index('by-status');
  const syncing = await index.getAll('syncing');
  const now = Date.now();
  let resetCount = 0;
  for (const event of syncing) {
    const startedAt = event.syncingStartedAt ? new Date(event.syncingStartedAt).getTime() : 0;
    if (now - startedAt >= olderThanMs) {
      event.status = 'pending';
      event.syncingStartedAt = null;
      await tx.store.put(event);
      resetCount += 1;
    }
  }
  await tx.done;
  if (resetCount) await writeSyncStatusSummary();
  return resetCount;
}

/** synced 이벤트 중 48시간 지난 것을 삭제한다. */
export async function prune(): Promise<number> {
  const db = await getDB();
  const cutoff = Date.now() - PRUNE_AFTER_MS;
  const tx = db.transaction(EVENTS_STORE, 'readwrite');
  const index = tx.store.index('by-status');
  const synced = await index.getAll('synced');
  let deleted = 0;
  for (const event of synced) {
    const syncedAt = event.syncedAt ? new Date(event.syncedAt).getTime() : 0;
    if (syncedAt <= cutoff) {
      await tx.store.delete(event.eventId);
      deleted += 1;
    }
  }
  await tx.done;
  if (deleted) await writeSyncStatusSummary();
  return deleted;
}

/**
 * 큐 상한(기본 5000) 초과 시 synced부터 정리하고, 그래도 넘치면 최고령 pending을 퇴출한다.
 * pending 퇴출만 실제 데이터 유실이므로 그 개수만 droppedCount로 누적·반환한다.
 */
export async function evictIfOver(limit: number = QUEUE_LIMIT): Promise<number> {
  const db = await getDB();
  const total = await db.count(EVENTS_STORE);
  if (total <= limit) return 0;

  let overBy = total - limit;
  const tx = db.transaction(EVENTS_STORE, 'readwrite');
  const index = tx.store.index('by-status');

  const synced = (await index.getAll('synced')).sort((a, b) =>
    (a.syncedAt ?? '').localeCompare(b.syncedAt ?? ''),
  );
  for (const event of synced) {
    if (overBy <= 0) break;
    await tx.store.delete(event.eventId);
    overBy -= 1;
  }

  let droppedCount = 0;
  if (overBy > 0) {
    const pending = (await index.getAll('pending')).sort((a, b) =>
      a.visitedAt.localeCompare(b.visitedAt),
    );
    for (const event of pending) {
      if (overBy <= 0) break;
      await tx.store.delete(event.eventId);
      overBy -= 1;
      droppedCount += 1;
    }
  }
  await tx.done;
  await writeSyncStatusSummary({}, droppedCount);
  return droppedCount;
}
