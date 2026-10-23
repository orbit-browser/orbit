// v1 로컬 큐에는 계정이 없다. 주인을 모르는 이벤트를 지금 계정에 붙이면 계정을 바꾼 브라우저에서
// 남의 방문이 그 계정으로 올라가므로, v2로 올릴 때 비운다.
import { openDB } from 'idb';
import { expect, it } from 'vitest';
import { getDB, EVENTS_STORE } from '../../lib/events/db';

it('v1 → v2 업그레이드는 계정 없는 이벤트를 지우고 계정 색인을 만든다', async () => {
  const v1 = await openDB('orbit', 1, {
    upgrade(db) {
      const store = db.createObjectStore(EVENTS_STORE, { keyPath: 'eventId' });
      store.createIndex('by-status', 'status');
      store.createIndex('by-visitedAt', 'visitedAt');
    },
  });
  await v1.put(EVENTS_STORE, { eventId: 'legacy-1', status: 'pending', visitedAt: '2026-10-21T00:00:00.000Z' });
  v1.close();

  const db = await getDB();
  expect(db.version).toBe(2);
  expect(await db.count(EVENTS_STORE)).toBe(0);
  expect([...db.transaction(EVENTS_STORE).store.indexNames].sort()).toEqual([
    'by-account-status',
    'by-account-visitedAt',
    'by-status',
    'by-visitedAt',
  ]);
});
