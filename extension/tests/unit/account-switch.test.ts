// 같은 브라우저에서 계정을 바꿨을 때 이전 계정의 로컬 방문이 새 계정 화면에 보이거나
// 새 계정 이름으로 서버에 올라가면 안 된다(2026-10-22 팀 E2E 재시험에서 찾은 결함).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { postEventBatch, triggerServerSync } from '../../lib/api';
import {
  addEvent,
  finalizeOpenEvent,
  getEvent,
  getSyncStatus,
  setPendingChangeListener,
} from '../../lib/events/queue';
import { requestDrain } from '../../lib/sync/engine';
import { loadTimelineEntries } from '../../entrypoints/sidepanel/hooks/useTimeline';
import { clearEvents, makeInput } from '../helpers';

vi.mock('../../lib/api', () => ({
  postEventBatch: vi.fn().mockResolvedValue({ accepted: 0, duplicates: 0, filtered: 0, pending_total: 0 }),
  triggerServerSync: vi.fn().mockResolvedValue(undefined),
  fetchEventsByDate: vi.fn().mockResolvedValue([]),
  deleteServerEvent: vi.fn(),
}));

const mockPost = vi.mocked(postEventBatch);
const mockServerSync = vi.mocked(triggerServerSync);

const B = { id: 'user-b', token: 'token-b' };
const C = { id: 'user-c', token: 'token-c' };

async function signInAs(user: { id: string; token: string }) {
  await chrome.storage.local.set({
    'orbit:auth': {
      token: user.token,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      user: { id: user.id, email: `${user.id}@example.com`, name: user.id, picture: null },
    },
  });
}

async function seedPendingFor(accountId: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const event = await addEvent(makeInput({ accountId }));
    await finalizeOpenEvent(event.eventId, new Date().toISOString());
    ids.push(event.eventId);
  }
  return ids;
}

beforeEach(async () => {
  fakeBrowser.reset();
  setPendingChangeListener(null);
  await clearEvents();
  mockPost.mockClear().mockResolvedValue({ accepted: 0, duplicates: 0, filtered: 0, pending_total: 0 });
  mockServerSync.mockClear().mockResolvedValue(undefined);
});

describe('계정 전환 — 타임라인', () => {
  it('C로 로그인하면 B의 로컬 방문(open·pending)이 타임라인에 보이지 않는다', async () => {
    await signInAs(B);
    await seedPendingFor(B.id, 3);
    await addEvent(makeInput({ accountId: B.id }));

    await chrome.storage.local.remove('orbit:auth');
    await signInAs(C);
    const mine = await addEvent(makeInput({ accountId: C.id }));

    const entries = await loadTimelineEntries();
    expect(entries.map((e) => e.id)).toEqual([mine.eventId]);
  });

  it('로그아웃 상태에서는 타임라인이 비어 있다', async () => {
    await seedPendingFor(B.id, 2);
    expect(await loadTimelineEntries()).toEqual([]);
  });

  it('동기화 요약 숫자도 현재 계정 것만 센다', async () => {
    await signInAs(B);
    await seedPendingFor(B.id, 3);
    await signInAs(C);
    await seedPendingFor(C.id, 1);

    const status = await getSyncStatus();
    expect(status.pendingCount).toBe(1);
    expect(status.todayCount).toBe(1);
  });
});

describe('계정 전환 — 동기화', () => {
  it('C로 로그인한 상태의 drain은 B의 미전송 이벤트를 보내지 않는다', async () => {
    const bIds = await seedPendingFor(B.id, 2);
    const cIds = await seedPendingFor(C.id, 1);
    await signInAs(C);

    requestDrain('periodic');

    await vi.waitFor(async () => {
      expect((await getEvent(cIds[0]))!.status).toBe('synced');
      expect(mockServerSync).toHaveBeenCalled();
    });
    expect(mockPost).toHaveBeenCalledTimes(1);
    const [, wire, token] = mockPost.mock.calls[0];
    expect(wire.map((e) => e.id)).toEqual(cIds);
    expect(token).toBe(C.token);
    for (const id of bIds) expect((await getEvent(id))!.status).toBe('pending');
  });

  it('로그아웃 상태에서는 아무것도 보내지 않는다', async () => {
    await seedPendingFor(B.id, 2);

    requestDrain('manual');

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockServerSync).not.toHaveBeenCalled();
  });

  it('B가 로그아웃하는 순간 남은 B의 이벤트는 B의 토큰으로만 보낸다', async () => {
    await signInAs(B);
    const bIds = await seedPendingFor(B.id, 2);
    const { initTriggers } = await import('../../lib/sync/triggers');
    vi.spyOn(fakeBrowser.idle, 'onStateChanged', 'get').mockReturnValue({
      addListener: () => {},
    } as never);
    initTriggers();

    await chrome.storage.local.remove('orbit:auth');
    await signInAs(C);

    await vi.waitFor(async () => {
      for (const id of bIds) expect((await getEvent(id))!.status).toBe('synced');
    });
    for (const [, , token] of mockPost.mock.calls) expect(token).toBe(B.token);
  });
});

describe('계정 전환 — 수집기', () => {
  it('계정이 바뀌면 이전 계정의 열린 방문을 마감하고 탭 상태를 비운다(다음 계정 referrer로 새지 않게)', async () => {
    const { handleAccountChange } = await import('../../lib/events/collector');
    const open = await addEvent(makeInput({ accountId: B.id, tabId: 7 }));
    await chrome.storage.session.set({
      'orbit:tabState': { 7: { openEventId: open.eventId, lastUrl: 'https://b-private.example/doc' } },
    });

    await handleAccountChange();

    expect((await getEvent(open.eventId))!.status).toBe('pending');
    expect((await getEvent(open.eventId))!.accountId).toBe(B.id);
    expect(await chrome.storage.session.get('orbit:tabState')).toEqual({});
  });
});
