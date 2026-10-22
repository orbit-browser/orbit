// 시크릿 창은 수집하지 않는다(팀 수집 설계 보안 검토 2026-10-22, CTO 결정: 개인 수집에서도 막는다).
// manifest 의 incognito: 'not_allowed' 가 1차 방어이고, 수집기가 tab.incognito 를 보는 것이 2차 방어다.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import config from '../../wxt.config';
import { handlePageContentReady, initCollector } from '../../lib/events/collector';
import { addEvent, getEvent, listByStatus, setPendingChangeListener } from '../../lib/events/queue';
import { CONSENT_VERSION } from '../../lib/settings';
import { clearEvents, makeInput } from '../helpers';

vi.mock('../../lib/api', () => ({
  postEventBatch: vi.fn().mockResolvedValue({ accepted: 0, duplicates: 0, filtered: 0, pending_total: 0 }),
  triggerServerSync: vi.fn().mockResolvedValue(undefined),
}));

const USER = 'user-a';
const TAB_ID = 7;

function incognitoTab(url: string): chrome.tabs.Tab {
  return {
    id: TAB_ID, windowId: 2, index: 0, active: true, highlighted: true, pinned: false,
    incognito: true, url, title: 'Secret', selected: true, discarded: false, autoDiscardable: true,
    groupId: -1, frozen: false,
  } as chrome.tabs.Tab;
}

function mockTab(tab: chrome.tabs.Tab) {
  // chrome.tabs.get 의 콜백 오버로드가 타입을 void 로 잡아 never 로 넘긴다.
  vi.spyOn(chrome.tabs, 'get').mockResolvedValue(tab as never);
}

async function startCollecting() {
  await chrome.storage.local.set({
    'orbit:auth': {
      token: 'token-a',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      user: { id: USER, email: 'a@example.com', name: 'a', picture: null },
    },
    'orbit:collectionConsent': { [USER]: CONSENT_VERSION },
    'orbit:settings': { collectionEnabled: true, contentCapture: true, excludeSensitive: true },
  });
  const idle = { setDetectionInterval: () => {}, onStateChanged: { addListener: () => {} } };
  vi.spyOn(fakeBrowser, 'idle', 'get').mockReturnValue(idle as never);
  initCollector();
}

function navDetails(url: string, transitionQualifiers: string[] = []) {
  return {
    frameId: 0, tabId: TAB_ID, url, transitionQualifiers, transitionType: 'link', processId: 1,
    timeStamp: Date.now(), documentId: 'doc', documentLifecycle: 'active',
    frameType: 'outermost_frame', parentFrameId: -1,
  } as never;
}

async function allEvents() {
  return [...(await listByStatus('open')), ...(await listByStatus('pending'))];
}

async function seedOpenEventForTab() {
  const event = await addEvent(makeInput({ accountId: USER, tabId: TAB_ID, title: 'before' }));
  await chrome.storage.session.set({
    'orbit:tabState': { [TAB_ID]: { openEventId: event.eventId, lastUrl: event.url, accountId: USER } },
  });
  return event.eventId;
}

beforeEach(async () => {
  vi.restoreAllMocks();
  fakeBrowser.reset();
  fakeBrowser.webNavigation.onCommitted.removeAllListeners();
  fakeBrowser.webNavigation.onHistoryStateUpdated.removeAllListeners();
  fakeBrowser.tabs.onUpdated.removeAllListeners();
  setPendingChangeListener(null);
  await clearEvents();
});

describe('manifest', () => {
  it('시크릿 창에서 확장이 돌지 않게 한다', () => {
    expect((config.manifest as { incognito?: string }).incognito).toBe('not_allowed');
  });
});

describe('수집기 이중 방어 — 시크릿 탭', () => {
  it('방문(열기)을 큐에 넣지 않는다', async () => {
    await startCollecting();
    mockTab(incognitoTab('https://secret.example/'));

    await fakeBrowser.webNavigation.onCommitted.trigger(navDetails('https://secret.example/'));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(await allEvents()).toHaveLength(0);
  });

  it('리다이렉트로 직전 이벤트 주소를 바꾸지 않는다', async () => {
    await startCollecting();
    const eventId = await seedOpenEventForTab();
    mockTab(incognitoTab('https://secret.example/after'));

    await fakeBrowser.webNavigation.onCommitted.trigger(
      navDetails('https://secret.example/after', ['server_redirect']),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect((await getEvent(eventId))!.url).not.toBe('https://secret.example/after');
    expect(await allEvents()).toHaveLength(1);
  });

  it('SPA 이동을 큐에 넣지 않는다', async () => {
    await startCollecting();
    mockTab(incognitoTab('https://secret.example/#/b'));

    await fakeBrowser.webNavigation.onHistoryStateUpdated.trigger(navDetails('https://secret.example/#/b'));
    await new Promise((resolve) => setTimeout(resolve, 700));

    expect(await allEvents()).toHaveLength(0);
  });

  it('제목 갱신을 반영하지 않는다', async () => {
    await startCollecting();
    const eventId = await seedOpenEventForTab();

    await fakeBrowser.tabs.onUpdated.trigger(
      TAB_ID,
      { title: 'Secret inbox' },
      incognitoTab('https://secret.example/'),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect((await getEvent(eventId))!.title).toBe('before');
  });

  it('본문을 붙이지 않는다', async () => {
    await startCollecting();
    const eventId = await seedOpenEventForTab();
    mockTab(incognitoTab('https://secret.example/'));

    await handlePageContentReady(TAB_ID, { title: 'Secret', textContent: 'private body', excerpt: '', length: 12 });

    expect((await getEvent(eventId))!.contentExcerpt).toBeNull();
  });

  it('일반 탭 방문은 그대로 기록한다(대조군)', async () => {
    await startCollecting();
    mockTab({ ...incognitoTab('https://public.example/'), incognito: false });

    await fakeBrowser.webNavigation.onCommitted.trigger(navDetails('https://public.example/'));

    await vi.waitFor(async () => expect(await allEvents()).toHaveLength(1));
  });
});
