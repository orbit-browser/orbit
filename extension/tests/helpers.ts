import { getDB, EVENTS_STORE } from '../lib/events/db';
import type { NewEventInput } from '../lib/events/types';

let seq = 0;

/** 필수 필드를 채운 NewEventInput — 테스트별로 필요한 값만 덮어쓴다. */
export function makeInput(overrides: Partial<NewEventInput> = {}): NewEventInput {
  seq += 1;
  return {
    eventId: `evt-${seq}-${crypto.randomUUID()}`,
    eventType: 'visit',
    url: `https://example.com/page-${seq}`,
    title: `Page ${seq}`,
    domain: 'example.com',
    visitedAt: new Date().toISOString(),
    endedAt: null,
    tabId: 1,
    windowId: 1,
    referrerUrl: null,
    previousEventId: null,
    activeDurationMs: 0,
    contentExcerpt: null,
    ...overrides,
  };
}

/** 테스트 간 격리 — events 스토어를 비운다(getDB 싱글턴은 유지). */
export async function clearEvents(): Promise<void> {
  const db = await getDB();
  await db.clear(EVENTS_STORE);
}
