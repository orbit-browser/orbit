// 수집 동의는 계정별이다(CTO 결정 2026-10-22). B가 켠 수집이 같은 브라우저에 로그인한 C에게
// 이어지면 동의한 사람과 수집되는 사람이 달라진다.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { initCollector } from '../../lib/events/collector';
import { listByStatus, setPendingChangeListener } from '../../lib/events/queue';
import { getSettings, updateSettings } from '../../lib/settings';
import { initTriggers } from '../../lib/sync/triggers';
import { clearEvents } from '../helpers';

vi.mock('../../lib/api', () => ({
  postEventBatch: vi.fn().mockResolvedValue({ accepted: 0, duplicates: 0, filtered: 0, pending_total: 0 }),
  triggerServerSync: vi.fn().mockResolvedValue(undefined),
}));

const B = 'user-b';
const C = 'user-c';

async function signInAs(id: string) {
  await chrome.storage.local.set({
    'orbit:auth': {
      token: `token-${id}`,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      user: { id, email: `${id}@example.com`, name: id, picture: null },
    },
  });
}

async function signOut() {
  await chrome.storage.local.remove('orbit:auth');
}

/** fakeBrowser 에 없는 chrome.idle 을 막고 SW 컴포지션 루트처럼 리스너를 등록한다. */
function startServiceWorker() {
  const idle = { setDetectionInterval: () => {}, onStateChanged: { addListener: () => {} } };
  vi.spyOn(fakeBrowser, 'idle', 'get').mockReturnValue(idle as never);
  initCollector();
  initTriggers();
}

async function visit(url: string) {
  await fakeBrowser.webNavigation.onCommitted.trigger({
    frameId: 0,
    tabId: 0,
    url,
    transitionQualifiers: [],
    transitionType: 'link',
    processId: 1,
    timeStamp: Date.now(),
    documentId: 'doc',
    documentLifecycle: 'active',
    frameType: 'outermost_frame',
    parentFrameId: -1,
  } as never);
}

async function allEvents() {
  return [...(await listByStatus('open')), ...(await listByStatus('pending'))];
}

beforeEach(async () => {
  fakeBrowser.reset();
  // fakeBrowser.reset 은 webNavigation 리스너를 지우지 않는다 — 앞 시험의 수집기가 남으면 방문이 겹쳐 기록된다.
  fakeBrowser.webNavigation.onCommitted.removeAllListeners();
  setPendingChangeListener(null);
  await clearEvents();
});

describe('계정별 수집 동의', () => {
  it('B가 동의한 뒤 C가 로그인하면 수집이 멈추고, C가 동의하기 전 방문은 0건이다', async () => {
    await signInAs(B);
    await chrome.storage.local.set({ 'orbit:collectionConsent': {} });
    startServiceWorker();
    await updateSettings({ collectionEnabled: true });

    await signOut();
    await signInAs(C);
    await vi.waitFor(async () => expect((await getSettings()).collectionEnabled).toBe(false));

    await visit('https://c-private.example/');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await allEvents()).toHaveLength(0);
  });

  it('스위치가 아직 이전 계정 값이어도 동의하지 않은 계정의 방문은 기록하지 않는다', async () => {
    await chrome.storage.local.set({
      'orbit:collectionConsent': { [B]: true },
      'orbit:settings': { collectionEnabled: true },
    });
    await signInAs(C);
    const idle = { setDetectionInterval: () => {}, onStateChanged: { addListener: () => {} } };
    vi.spyOn(fakeBrowser, 'idle', 'get').mockReturnValue(idle as never);
    initCollector();

    await visit('https://c-private.example/');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await allEvents()).toHaveLength(0);
  });

  it('B가 다시 로그인하면 B의 이전 동의를 그대로 쓴다', async () => {
    await signInAs(B);
    await chrome.storage.local.set({ 'orbit:collectionConsent': {} });
    startServiceWorker();
    await updateSettings({ collectionEnabled: true });

    await signOut();
    await signInAs(C);
    await vi.waitFor(async () => expect((await getSettings()).collectionEnabled).toBe(false));
    await signOut();
    await signInAs(B);
    await vi.waitFor(async () => expect((await getSettings()).collectionEnabled).toBe(true));

    await visit('https://b.example/');
    await vi.waitFor(async () => expect(await allEvents()).toHaveLength(1));
    expect((await allEvents())[0].accountId).toBe(B);
  });

  it('업데이트 전에 수집을 켜 둔 사용자는 지금 계정의 동의로 옮겨져 다시 묻지 않는다', async () => {
    await chrome.storage.local.set({ 'orbit:settings': { collectionEnabled: true } });
    await signInAs(B);
    startServiceWorker();

    await vi.waitFor(async () => {
      const stored = await chrome.storage.local.get('orbit:collectionConsent');
      expect(stored['orbit:collectionConsent']).toEqual({ [B]: true });
    });
    expect((await getSettings()).collectionEnabled).toBe(true);
  });
});

describe('계정 교체 순간의 탭 상태', () => {
  it('정리보다 먼저 온 새 계정의 방문은 이전 계정의 탭 상태를 referrer로 잇지 않는다', async () => {
    await chrome.storage.local.set({
      'orbit:collectionConsent': { [C]: true },
      'orbit:settings': { collectionEnabled: true },
    });
    await signInAs(C);
    // 계정 전환 정리(handleAccountChange)가 아직 돌지 않아 B의 탭 상태가 남아 있는 순간
    await chrome.storage.session.set({
      'orbit:tabState': { 0: { openEventId: 'b-open', lastUrl: 'https://b-private.example/doc', accountId: B } },
    });
    const idle = { setDetectionInterval: () => {}, onStateChanged: { addListener: () => {} } };
    vi.spyOn(fakeBrowser, 'idle', 'get').mockReturnValue(idle as never);
    initCollector();

    await visit('https://c.example/');
    await vi.waitFor(async () => expect(await allEvents()).toHaveLength(1));
    const [event] = await allEvents();
    expect(event.accountId).toBe(C);
    expect(event.referrerUrl).toBeNull();
    expect(event.previousEventId).toBeNull();
  });
});
