import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import {
  addDwell,
  addEvent,
  attachContent,
  claimPending,
  evictIfOver,
  finalizeAllOpen,
  finalizeOpenEvent,
  getEvent,
  getSyncStatus,
  listByStatus,
  markSynced,
  prune,
  releaseToPending,
  replaceEventUrl,
  resetStaleSyncing,
  setPendingChangeListener,
} from '../../lib/events/queue';
import { MAX_CONTENT_EXCERPT_LENGTH } from '../../lib/events/types';
import { clearEvents, makeInput } from '../helpers';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

beforeEach(async () => {
  fakeBrowser.reset();
  setPendingChangeListener(null);
  await clearEvents();
});

async function addPendingEvent(overrides: Parameters<typeof makeInput>[0] = {}) {
  const event = await addEvent(makeInput(overrides));
  await finalizeOpenEvent(event.eventId, new Date().toISOString());
  return (await getEvent(event.eventId))!;
}

describe('addEvent', () => {
  it('open 상태와 로컬 전용 기본값으로 적재한다', async () => {
    const event = await addEvent(makeInput());
    const stored = await getEvent(event.eventId);
    expect(stored).toMatchObject({
      status: 'open',
      failureCount: 0,
      nextAttemptAt: null,
      syncedAt: null,
      syncingStartedAt: null,
    });
    expect(stored!.createdAt).toBeTruthy();
  });
});

describe('finalizeOpenEvent / finalizeAllOpen', () => {
  it('open→pending 전환과 endedAt 기록', async () => {
    const event = await addEvent(makeInput());
    await finalizeOpenEvent(event.eventId, '2026-08-05T01:00:00.000Z');
    const stored = await getEvent(event.eventId);
    expect(stored!.status).toBe('pending');
    expect(stored!.endedAt).toBe('2026-08-05T01:00:00.000Z');
  });

  it('open이 아닌 이벤트에는 no-op이다', async () => {
    const event = await addPendingEvent();
    await finalizeOpenEvent(event.eventId, '2099-01-01T00:00:00.000Z');
    const stored = await getEvent(event.eventId);
    expect(stored!.endedAt).not.toBe('2099-01-01T00:00:00.000Z');
  });

  it('finalizeAllOpen은 모든 open 이벤트를 pending으로 마감한다', async () => {
    await addEvent(makeInput());
    await addEvent(makeInput());
    await addPendingEvent();
    await finalizeAllOpen();
    expect(await listByStatus('open')).toHaveLength(0);
    expect(await listByStatus('pending')).toHaveLength(3);
  });
});

describe('attachContent', () => {
  it('open 상태에만 부착하고 최대 길이로 자른다', async () => {
    const event = await addEvent(makeInput());
    await attachContent(event.eventId, 'x'.repeat(MAX_CONTENT_EXCERPT_LENGTH + 100));
    const stored = await getEvent(event.eventId);
    expect(stored!.contentExcerpt).toHaveLength(MAX_CONTENT_EXCERPT_LENGTH);
  });

  it('finalize된 이벤트에는 부착하지 않는다(다른 페이지 DOM 오염 방지)', async () => {
    const event = await addPendingEvent();
    await attachContent(event.eventId, '늦게 도착한 본문');
    const stored = await getEvent(event.eventId);
    expect(stored!.contentExcerpt).toBeNull();
  });
});

describe('addDwell / replaceEventUrl', () => {
  it('체류시간을 누적하고 0 이하는 무시한다', async () => {
    const event = await addEvent(makeInput());
    await addDwell(event.eventId, 1000);
    await addDwell(event.eventId, 500);
    await addDwell(event.eventId, 0);
    await addDwell(event.eventId, -10);
    expect((await getEvent(event.eventId))!.activeDurationMs).toBe(1500);
  });

  it('URL 치환은 open 상태에서만 성공한다', async () => {
    const open = await addEvent(makeInput());
    expect(await replaceEventUrl(open.eventId, 'https://final.com/x', 'final.com')).toBe(true);
    expect((await getEvent(open.eventId))!.url).toBe('https://final.com/x');

    const pending = await addPendingEvent();
    expect(await replaceEventUrl(pending.eventId, 'https://nope.com', 'nope.com')).toBe(false);
  });
});

describe('claimPending', () => {
  it('오래된 visitedAt 순으로 limit개만 syncing으로 전환한다', async () => {
    const base = Date.now();
    const old = await addPendingEvent({ visitedAt: new Date(base - 3 * HOUR_MS).toISOString() });
    const mid = await addPendingEvent({ visitedAt: new Date(base - 2 * HOUR_MS).toISOString() });
    const recent = await addPendingEvent({ visitedAt: new Date(base - HOUR_MS).toISOString() });

    const claimed = await claimPending(2);
    expect(claimed.map((e) => e.eventId)).toEqual([old.eventId, mid.eventId]);
    expect((await getEvent(old.eventId))!.status).toBe('syncing');
    expect((await getEvent(old.eventId))!.syncingStartedAt).toBeTruthy();
    expect((await getEvent(recent.eventId))!.status).toBe('pending');
  });

  it('nextAttemptAt이 미래인 이벤트(백오프 대기)는 claim하지 않는다', async () => {
    const waiting = await addPendingEvent();
    await claimPending(10);
    await releaseToPending([waiting.eventId], { backoff: true });

    const ready = await addPendingEvent();
    const claimed = await claimPending(10);
    expect(claimed.map((e) => e.eventId)).toEqual([ready.eventId]);
  });
});

describe('markSynced / releaseToPending', () => {
  it('markSynced는 synced 전환 + syncedAt 기록 + syncingStartedAt 해제', async () => {
    const event = await addPendingEvent();
    await claimPending(1);
    await markSynced([event.eventId]);
    const stored = await getEvent(event.eventId);
    expect(stored!.status).toBe('synced');
    expect(stored!.syncedAt).toBeTruthy();
    expect(stored!.syncingStartedAt).toBeNull();
  });

  it('backoff:true는 failureCount 증가 + 2^n분 뒤 nextAttemptAt 설정', async () => {
    const event = await addPendingEvent();
    await claimPending(1);
    const [updated] = await releaseToPending([event.eventId], { backoff: true });
    expect(updated.status).toBe('pending');
    expect(updated.failureCount).toBe(1);
    const delayMs = new Date(updated.nextAttemptAt!).getTime() - Date.now();
    expect(delayMs).toBeGreaterThan(1.9 * MINUTE_MS);
    expect(delayMs).toBeLessThanOrEqual(2 * MINUTE_MS + 1000);
  });

  it('백오프는 30분에서 상한된다', async () => {
    const event = await addPendingEvent();
    // failureCount 5 → 2^5=32분 → 상한 30분
    for (let i = 0; i < 5; i += 1) {
      await releaseToPending([event.eventId], { backoff: true });
    }
    const stored = await getEvent(event.eventId);
    expect(stored!.failureCount).toBe(5);
    const delayMs = new Date(stored!.nextAttemptAt!).getTime() - Date.now();
    expect(delayMs).toBeLessThanOrEqual(30 * MINUTE_MS + 1000);
    expect(delayMs).toBeGreaterThan(29 * MINUTE_MS);
  });

  it('backoff:false는 nextAttemptAt을 해제한다', async () => {
    const event = await addPendingEvent();
    await releaseToPending([event.eventId], { backoff: true });
    const [updated] = await releaseToPending([event.eventId], { backoff: false });
    expect(updated.nextAttemptAt).toBeNull();
  });
});

describe('resetStaleSyncing', () => {
  it('임계 시간을 넘긴 syncing 고아만 pending으로 되돌린다', async () => {
    const stale = await addPendingEvent();
    const fresh = await addPendingEvent();
    await claimPending(10);

    // stale 쪽의 syncingStartedAt을 6분 전으로 조작
    const { getDB, EVENTS_STORE } = await import('../../lib/events/db');
    const db = await getDB();
    const staleStored = (await db.get(EVENTS_STORE, stale.eventId))!;
    staleStored.syncingStartedAt = new Date(Date.now() - 6 * MINUTE_MS).toISOString();
    await db.put(EVENTS_STORE, staleStored);

    const resetCount = await resetStaleSyncing(5 * MINUTE_MS);
    expect(resetCount).toBe(1);
    expect((await getEvent(stale.eventId))!.status).toBe('pending');
    expect((await getEvent(fresh.eventId))!.status).toBe('syncing');
  });
});

describe('prune', () => {
  it('48시간 지난 synced만 삭제한다', async () => {
    const oldSynced = await addPendingEvent();
    const newSynced = await addPendingEvent();
    await claimPending(10);
    await markSynced([oldSynced.eventId, newSynced.eventId]);

    const { getDB, EVENTS_STORE } = await import('../../lib/events/db');
    const db = await getDB();
    const stored = (await db.get(EVENTS_STORE, oldSynced.eventId))!;
    stored.syncedAt = new Date(Date.now() - 49 * HOUR_MS).toISOString();
    await db.put(EVENTS_STORE, stored);

    const deleted = await prune();
    expect(deleted).toBe(1);
    expect(await getEvent(oldSynced.eventId)).toBeUndefined();
    expect(await getEvent(newSynced.eventId)).toBeDefined();
  });
});

describe('evictIfOver', () => {
  it('synced부터 정리하고, 그래도 넘치면 최고령 pending을 퇴출하며 그 수만 droppedCount로 센다', async () => {
    const base = Date.now();
    const syncedEvent = await addPendingEvent({
      visitedAt: new Date(base - 5 * HOUR_MS).toISOString(),
    });
    await claimPending(1);
    await markSynced([syncedEvent.eventId]);

    const oldest = await addPendingEvent({ visitedAt: new Date(base - 4 * HOUR_MS).toISOString() });
    const middle = await addPendingEvent({ visitedAt: new Date(base - 3 * HOUR_MS).toISOString() });
    const newest = await addPendingEvent({ visitedAt: new Date(base - 2 * HOUR_MS).toISOString() });

    // 총 4개, 상한 2 → 2개 초과: synced 1개 삭제 후 pending 최고령 1개 퇴출
    const dropped = await evictIfOver(2);
    expect(dropped).toBe(1);
    expect(await getEvent(syncedEvent.eventId)).toBeUndefined();
    expect(await getEvent(oldest.eventId)).toBeUndefined();
    expect(await getEvent(middle.eventId)).toBeDefined();
    expect(await getEvent(newest.eventId)).toBeDefined();

    const status = await getSyncStatus();
    expect(status.droppedCount).toBe(1);
  });

  it('상한 이하면 아무것도 하지 않는다', async () => {
    await addPendingEvent();
    expect(await evictIfOver(5000)).toBe(0);
  });
});

describe('getSyncStatus / pendingChangeListener', () => {
  it('요약이 pendingCount·todayCount를 반영하고 개수 트리거 리스너에 통지한다', async () => {
    const seen: number[] = [];
    setPendingChangeListener((count) => seen.push(count));

    await addPendingEvent();
    await addPendingEvent();

    const status = await getSyncStatus();
    expect(status.pendingCount).toBe(2);
    expect(status.todayCount).toBe(2);
    expect(seen.at(-1)).toBe(2);
  });
});
