// 수집 동의는 계정별이다(CTO 결정 2026-10-22). B가 켠 수집이 같은 브라우저에 로그인한 C에게
// 이어지면 동의한 사람과 수집되는 사람이 달라진다.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { initCollector } from '../../lib/events/collector';
import { listByStatus, setPendingChangeListener } from '../../lib/events/queue';
import { AI_DISCLOSURE, AI_DISCLOSURE_FORMAL, CONSENT_VERSION, getSettings, updateSettings } from '../../lib/settings';
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
      'orbit:collectionConsent': { [B]: CONSENT_VERSION },
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

  it('계정별 동의 전에 수집을 켜 둔 사용자는 지금 계정으로 옮기되, 지금 문구로 다시 묻는다', async () => {
    // 옛 동의는 KT가 빠진 문구에 받은 것이다(DecisionLog 2026-10-23).
    await chrome.storage.local.set({ 'orbit:settings': { collectionEnabled: true } });
    await signInAs(B);
    startServiceWorker();

    // 옮긴 옛 동의(true)는 지금 버전이 아니라 스위치가 꺼지고, 꺼진 값이 B의 동의로 남는다.
    await vi.waitFor(async () => expect((await getSettings()).collectionEnabled).toBe(false));
    const stored = await chrome.storage.local.get('orbit:collectionConsent');
    expect(stored['orbit:collectionConsent']).toEqual({ [B]: false });
  });
});

describe('동의 문구 버전', () => {
  it('KT 믿:음을 넣은 문구의 동의 버전은 2다', () => {
    // 저장된 동의 값과 비교하는 버전이다. 문구를 바꾸지 않고 올리거나 내리면 모든 계정의 동의가 흔들린다.
    expect(CONSENT_VERSION).toBe(2);
  });

  it('외부 AI 안내에 KT 믿:음을 밝힌다', () => {
    // 'SKT'에도 'KT'가 들어 있어 모델 이름까지 본다.
    expect(AI_DISCLOSURE).toContain('KT 믿:음');
    expect(AI_DISCLOSURE_FORMAL).toContain('KT 믿:음');
  });

  it('공급자가 늘기 전 문구에 동의한 계정은 다시 동의하기 전까지 수집하지 않는다', async () => {
    await chrome.storage.local.set({
      'orbit:collectionConsent': { [B]: true },
      'orbit:settings': { collectionEnabled: true },
    });
    await signInAs(B);
    startServiceWorker();

    await vi.waitFor(async () => expect((await getSettings()).collectionEnabled).toBe(false));
    await visit('https://b-before-reconsent.example/');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await allEvents()).toHaveLength(0);
  });

  it('다시 동의하면 지금 문구 버전으로 저장하고 수집을 이어 간다', async () => {
    await chrome.storage.local.set({ 'orbit:collectionConsent': { [B]: true } });
    await signInAs(B);
    startServiceWorker();

    await updateSettings({ collectionEnabled: true });
    const stored = await chrome.storage.local.get('orbit:collectionConsent');
    expect(stored['orbit:collectionConsent']).toEqual({ [B]: CONSENT_VERSION });

    await visit('https://b-after-reconsent.example/');
    await vi.waitFor(async () => expect(await allEvents()).toHaveLength(1));
  });
});

describe('계정 교체 순간의 탭 상태', () => {
  it('정리보다 먼저 온 새 계정의 방문은 이전 계정의 탭 상태를 referrer로 잇지 않는다', async () => {
    await chrome.storage.local.set({
      'orbit:collectionConsent': { [C]: CONSENT_VERSION },
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
