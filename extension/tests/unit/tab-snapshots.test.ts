// 탭 화면 미리보기(지시 7f): 기기 안에만, 계정별로, 민감·로그인·시크릿·동의 없음은 찍지 않는다.
// chrome.tabs 는 대역이고, 서비스 워커의 이미지 API(createImageBitmap·OffscreenCanvas)도 대역이다.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import config from '../../wxt.config';
import { CONSENT_VERSION } from '../../lib/settings';
import {
  canSnapshotUrl,
  captureVisibleTab,
  MIN_CAPTURE_GAP_MS,
  resetCaptureThrottle,
  SAME_PAGE_INTERVAL_MS,
} from '../../lib/tab-capture';
import {
  canShowSnapshots,
  clearSnapshots,
  loadSnapshots,
  pruneOtherAccountSnapshots,
  putSnapshot,
  SNAPSHOT_MAX_BYTES,
  SNAPSHOT_MAX_COUNT,
  snapshotCapturedAt,
  snapshotKey,
} from '../../lib/tab-snapshots';

const USER = 'user-a';
const WINDOW = 3;
const PAGE = 'https://example.com/guide';

function tab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: 9, windowId: WINDOW, index: 0, active: true, highlighted: true, pinned: false, incognito: false,
    url: PAGE, title: 'Guide', status: 'complete', selected: true, discarded: false, autoDiscardable: true,
    groupId: -1, frozen: false, ...overrides,
  } as chrome.tabs.Tab;
}

let activeTabs: chrome.tabs.Tab[] = [];
let captureCalls = 0;

async function signIn(consent: number | boolean = CONSENT_VERSION, settings: Record<string, unknown> = {}) {
  await chrome.storage.local.set({
    'orbit:auth': {
      token: 'token-a',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      user: { id: USER, email: 'a@example.com', name: 'a', picture: null },
    },
    'orbit:collectionConsent': { [USER]: consent },
    'orbit:settings': { collectionEnabled: consent === CONSENT_VERSION, ...settings },
  });
}

/** 찍기 대역 — 부를 때마다 차례로 보이는 탭을 바꿀 수 있다(찍는 사이 탭 전환). */
function installTabs(onCapture?: () => void) {
  vi.spyOn(chrome.tabs, 'query').mockImplementation((async () => activeTabs) as never);
  (chrome.tabs as unknown as { captureVisibleTab: unknown }).captureVisibleTab = vi.fn(async () => {
    captureCalls += 1;
    onCapture?.();
    return 'data:image/jpeg;base64,AAAA';
  });
}

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  fakeBrowser.reset();
  resetCaptureThrottle();
  await clearSnapshots(USER);
  await clearSnapshots('user-b');
  activeTabs = [tab()];
  captureCalls = 0;
  installTabs();
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1600, height: 1000, close: () => undefined })));
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        return { drawImage: () => undefined };
      }
      async convertToBlob() {
        return new Blob([`jpeg ${this.width}x${this.height}`], { type: 'image/jpeg' });
      }
    },
  );
});

const saved = async (url = PAGE, account = USER) => (await loadSnapshots(account, [url]))[snapshotKey(url)!];

describe('찍는 곳과 찍지 않는 곳', () => {
  it('보이는 일반 페이지는 400px 폭 JPEG 로 지금 계정에 저장한다', async () => {
    await signIn();
    expect(await captureVisibleTab(WINDOW)).toBe(true);
    // 1600x1000 → 400x250 으로 줄여 다시 인코딩한 결과다.
    expect(atob((await saved())!.split(',')[1])).toBe('jpeg 400x250');
    expect(await saved(PAGE, 'user-b')).toBeUndefined();
  });

  it.each([
    ['민감 도메인', 'https://obank.kbstar.com/quics'],
    ['민감 경로(로그인)', 'https://example.com/login'],
    ['결제 경로', 'https://shop.example.com/checkout/step1'],
    ['로그인 호스트', 'https://accounts.google.com/v3/signin'],
    ['로그인 경로(팀 수집 표)', 'https://github.com/session'],
    ['내부 페이지', 'chrome://settings'],
    ['웹메일', 'https://mail.google.com/mail/u/0/#inbox'],
    ['메신저', 'https://app.slack.com/client/T1/C1'],
    ['검색 결과', 'https://www.google.com/search?q=orbit'],
  ])('%s는 찍지 않는다', async (_label, url) => {
    await signIn();
    activeTabs = [tab({ url })];
    expect(await captureVisibleTab(WINDOW)).toBe(false);
    expect(captureCalls).toBe(0);
  });

  it('시크릿 탭은 찍지 않는다', async () => {
    await signIn();
    activeTabs = [tab({ incognito: true })];
    expect(await captureVisibleTab(WINDOW)).toBe(false);
    expect(captureCalls).toBe(0);
  });

  it('수집 동의가 없거나 옛 버전이면 찍지 않는다', async () => {
    await signIn(false);
    expect(await captureVisibleTab(WINDOW)).toBe(false);
    await signIn(1);
    expect(await captureVisibleTab(WINDOW)).toBe(false);
    expect(captureCalls).toBe(0);
  });

  it('로그아웃 상태에서는 찍지 않는다', async () => {
    expect(await captureVisibleTab(WINDOW)).toBe(false);
    expect(captureCalls).toBe(0);
  });

  it('설정에서 끄면 찍지 않는다', async () => {
    await signIn(CONSENT_VERSION, { tabSnapshotsEnabled: false });
    expect(await captureVisibleTab(WINDOW)).toBe(false);
    expect(captureCalls).toBe(0);
  });

  it('아직 로드 중인 탭은 찍지 않는다(앞 화면이 남아 있을 수 있다)', async () => {
    await signIn();
    activeTabs = [tab({ status: 'loading' })];
    expect(await captureVisibleTab(WINDOW)).toBe(false);
  });

  it('찍는 사이 다른 탭으로 바뀌면 그 사진을 버린다', async () => {
    await signIn();
    installTabs(() => {
      activeTabs = [tab({ id: 10, url: 'https://example.com/other' })];
    });
    expect(await captureVisibleTab(WINDOW)).toBe(false);
    expect(captureCalls).toBe(1);
    expect(await saved()).toBeUndefined();
    expect(await saved('https://example.com/other')).toBeUndefined();
  });

  it('찍는 사이 계정이 바뀌면 그 사진을 버린다', async () => {
    await signIn();
    installTabs(() => {
      void chrome.storage.local.set({
        'orbit:auth': {
          token: 't',
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          user: { id: 'user-b', email: 'b@example.com', name: 'b', picture: null },
        },
      });
    });
    expect(await captureVisibleTab(WINDOW)).toBe(false);
    expect(await saved()).toBeUndefined();
    expect(await saved(PAGE, 'user-b')).toBeUndefined();
  });

  it('주소 판정: http(s) 일반 페이지만', () => {
    expect(canSnapshotUrl('https://example.com/a')).toBe(true);
    expect(canSnapshotUrl('http://example.com/a')).toBe(true);
    expect(canSnapshotUrl('about:blank')).toBe(false);
    expect(canSnapshotUrl(undefined)).toBe(false);
    expect(canSnapshotUrl('https://example.com/%6Cogin/')).toBe(false);
  });
});

describe('빈도 상한', () => {
  it('같은 페이지는 10분 안에 다시 찍지 않고, 지나면 새로 찍는다', async () => {
    await signIn();
    const now = Date.now();
    await putSnapshot(USER, PAGE, 'data:old', now - SAME_PAGE_INTERVAL_MS + 60_000);
    expect(await captureVisibleTab(WINDOW)).toBe(false);
    expect(captureCalls).toBe(0);

    await putSnapshot(USER, PAGE, 'data:old', now - SAME_PAGE_INTERVAL_MS - 1);
    expect(await captureVisibleTab(WINDOW)).toBe(true);
    expect(await saved()).not.toBe('data:old');
  });

  it('조각(#)만 다른 주소는 같은 페이지다', async () => {
    await signIn();
    await captureVisibleTab(WINDOW);
    resetCaptureThrottle();
    activeTabs = [tab({ url: `${PAGE}#section-2` })];
    expect(await captureVisibleTab(WINDOW)).toBe(false);
    expect(captureCalls).toBe(1);
  });

  it('전체는 1초에 한 번을 넘지 않는다', async () => {
    await signIn();
    expect(await captureVisibleTab(WINDOW)).toBe(true);
    activeTabs = [tab({ url: 'https://example.com/next' })];
    expect(await captureVisibleTab(WINDOW)).toBe(false);
    expect(captureCalls).toBe(1);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + MIN_CAPTURE_GAP_MS + 1);
    expect(await captureVisibleTab(WINDOW)).toBe(true);
  });
});

describe('저장 상한과 정리', () => {
  it(`개수가 ${SNAPSHOT_MAX_COUNT}장을 넘으면 가장 오래 찍은 것부터 지운다`, async () => {
    const base = Date.now() - 1_000_000;
    for (let i = 0; i < SNAPSHOT_MAX_COUNT + 3; i += 1) {
      await putSnapshot(i % 2 ? USER : 'user-b', `https://example.com/p${i}`, 'data:x', base + i);
    }
    const all = { ...(await loadSnapshots(USER, urls(SNAPSHOT_MAX_COUNT + 3))), ...(await loadSnapshots('user-b', urls(SNAPSHOT_MAX_COUNT + 3))) };
    expect(Object.keys(all)).toHaveLength(SNAPSHOT_MAX_COUNT);
    expect(all['https://example.com/p0']).toBeUndefined();
    expect(all['https://example.com/p2']).toBeUndefined();
    expect(all['https://example.com/p3']).toBe('data:x');
  });

  it('용량 상한을 넘으면 오래된 것부터 지운다', async () => {
    // 두 장(0.8)은 들어가고 세 장(1.2)은 넘는다.
    const big = 'x'.repeat(Math.ceil(SNAPSHOT_MAX_BYTES * 0.4));
    await putSnapshot(USER, 'https://example.com/a', big, 1);
    await putSnapshot(USER, 'https://example.com/b', big, 2);
    await putSnapshot(USER, 'https://example.com/c', big, 3);
    await putSnapshot(USER, 'https://example.com/d', big, 4);
    const left = await loadSnapshots(USER, ['a', 'b', 'c', 'd'].map((p) => `https://example.com/${p}`));
    expect(Object.keys(left).sort()).toEqual(['https://example.com/c', 'https://example.com/d']);
  });

  it('다른 계정의 사진은 7일이 지나면 지우고, 지금 계정 것은 남긴다', async () => {
    const week = 7 * 86_400_000;
    await putSnapshot('user-b', 'https://example.com/old', 'data:b', Date.now() - week - 1);
    await putSnapshot('user-b', 'https://example.com/new', 'data:b', Date.now() - 1000);
    await putSnapshot(USER, 'https://example.com/mine', 'data:a', Date.now() - week - 1);
    expect(await pruneOtherAccountSnapshots(USER, week)).toBe(1);
    expect(await snapshotCapturedAt('user-b', 'https://example.com/old')).toBeNull();
    expect(await snapshotCapturedAt('user-b', 'https://example.com/new')).not.toBeNull();
    expect(await snapshotCapturedAt(USER, 'https://example.com/mine')).not.toBeNull();
  });

  it('지우기는 지금 계정 것만 지운다', async () => {
    await putSnapshot(USER, PAGE, 'data:a');
    await putSnapshot('user-b', PAGE, 'data:b');
    expect(await clearSnapshots(USER)).toBe(1);
    expect(await saved()).toBeUndefined();
    expect(await saved(PAGE, 'user-b')).toBe('data:b');
  });
});

describe('보이는 곳의 범위', () => {
  const me = { userId: 'me', name: '나', picture: null };
  const other = { userId: 'u2', name: '민지', picture: null };

  it('개인 범위는 붙이고, 팀 범위는 내가 공유한 세션에만 붙인다', () => {
    expect(canShowSnapshots(false, undefined, 'me')).toBe(true);
    expect(canShowSnapshots(true, me, 'me')).toBe(true);
    expect(canShowSnapshots(true, other, 'me')).toBe(false);
    // 공유자를 아직 모르거나(목록 받기 전) 내가 누군지 모르면 붙이지 않는다.
    expect(canShowSnapshots(true, undefined, 'me')).toBe(false);
    expect(canShowSnapshots(true, me, null)).toBe(false);
  });
});

it('manifest 는 자동 캡처에 필요한 <all_urls> 호스트 권한을 갖는다(activeTab 은 클릭 순간만이라 못 쓴다)', () => {
  const manifest = config.manifest as { host_permissions?: string[]; permissions?: string[] };
  expect(manifest.host_permissions).toContain('<all_urls>');
  expect(manifest.permissions).not.toContain('activeTab');
});

function urls(n: number) {
  return Array.from({ length: n }, (_, i) => `https://example.com/p${i}`);
}
