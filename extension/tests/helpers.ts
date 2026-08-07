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

/**
 * 인증된 상태를 만든다 — API 호출은 저장된 세션 토큰을 요구한다(`lib/api.ts`).
 * 만료 시각을 넉넉히 두어 테스트 도중 만료로 실패하지 않게 한다.
 */
export async function signInTestUser(): Promise<void> {
  await chrome.storage.local.set({
    'orbit:auth': {
      token: 'test-token',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      user: { id: 'u1', email: 'test@example.com', name: '테스트', picture: null },
    },
  });
}

export async function signOutTestUser(): Promise<void> {
  await chrome.storage.local.remove('orbit:auth');
}
