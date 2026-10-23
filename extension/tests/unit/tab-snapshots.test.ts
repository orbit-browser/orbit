// 탭 화면 미리보기(지시 7f): 기기 안에만, 계정별로, 민감·로그인·시크릿·동의 없음은 찍지 않는다.
// chrome.tabs 는 대역이고, 서비스 워커의 이미지 API(createImageBitmap·OffscreenCanvas)도 대역이다.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import config from '../../wxt.config';
import { CONSENT_VERSION, DEFAULT_SETTINGS, getSettings } from '../../lib/settings';
import { signOut } from '../../lib/auth';
import { fetchTabSnapshots } from '../../lib/useTabSnapshots';
import {
  canSnapshotUrl,
  captureVisibleTab,
  initTabCapture,
  MIN_CAPTURE_GAP_MS,
  resetCaptureThrottle,
  SAME_PAGE_INTERVAL_MS,
} from '../../lib/tab-capture';
import {
  canShowSnapshots,
  clearSnapshots,
  disableTabSnapshots,
  enableTabSnapshots,
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
/** 크롬 선택 권한(<all_urls>) 대역 */
let permissionGranted = true;
let permissionCalls: string[] = [];
function installPermissions(answer = true) {
  (chrome as unknown as { permissions: unknown }).permissions = {
    contains: vi.fn(async (p: chrome.permissions.Permissions) => {
      permissionCalls.push(`contains ${p.origins}`);
      return permissionGranted;
    }),
    request: vi.fn(async (p: chrome.permissions.Permissions) => {
      permissionCalls.push(`request ${p.origins}`);
      permissionGranted = answer;
      return answer;
    }),
    remove: vi.fn(async (p: chrome.permissions.Permissions) => {
      permissionCalls.push(`remove ${p.origins}`);
      permissionGranted = false;
      return true;
    }),
  };
}
let captureCalls = 0;

async function signIn(consent: number | boolean = CONSENT_VERSION, settings: Record<string, unknown> = {}) {
  await chrome.storage.local.set({
    'orbit:auth': {
      token: 'token-a',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      user: { id: USER, email: 'a@example.com', name: 'a', picture: null },
    },
    'orbit:collectionConsent': { [USER]: consent },
    'orbit:settings': { collectionEnabled: consent === CONSENT_VERSION, tabSnapshotsEnabled: true, ...settings },
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
  permissionGranted = true;
  permissionCalls = [];
  installPermissions();
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

it('manifest: <all_urls> 는 설치 권한이 아니라 선택 권한이다(보안 검토 M1)', () => {
  const manifest = config.manifest as {
    host_permissions?: string[];
    optional_host_permissions?: string[];
    permissions?: string[];
  };
  expect(manifest.host_permissions).not.toContain('<all_urls>');
  expect(manifest.optional_host_permissions).toEqual(['<all_urls>']);
  expect(manifest.permissions).not.toContain('activeTab');
});

describe('켜기·끄기와 권한 (보안 검토 M1·M2)', () => {
  it('기본은 꺼져 있다', () => {
    expect(DEFAULT_SETTINGS.tabSnapshotsEnabled).toBe(false);
  });

  it('설정이 켜져 있어도 권한이 없으면(크롬에서 거둠) 찍지 않는다', async () => {
    await signIn();
    permissionGranted = false;
    expect(await captureVisibleTab(WINDOW)).toBe(false);
    expect(captureCalls).toBe(0);
  });

  it('켤 때 권한을 묻고, 거절하면 켜지 않는다', async () => {
    await signIn(CONSENT_VERSION, { tabSnapshotsEnabled: false });
    installPermissions(false);
    permissionGranted = false;
    expect(await enableTabSnapshots()).toBe(false);
    expect(permissionCalls).toEqual(['request <all_urls>']);
    expect((await getSettings()).tabSnapshotsEnabled).toBe(false);
  });

  it('권한을 받으면 켜지고 찍는다, 끄면 권한을 돌려주고 찍지 않는다', async () => {
    await signIn(CONSENT_VERSION, { tabSnapshotsEnabled: false });
    permissionGranted = false;
    expect(await enableTabSnapshots()).toBe(true);
    expect((await getSettings()).tabSnapshotsEnabled).toBe(true);
    expect(await captureVisibleTab(WINDOW)).toBe(true);

    await disableTabSnapshots();
    expect((await getSettings()).tabSnapshotsEnabled).toBe(false);
    expect(permissionCalls).toContain('remove <all_urls>');
    resetCaptureThrottle();
    activeTabs = [tab({ url: 'https://example.com/after-off' })];
    expect(await captureVisibleTab(WINDOW)).toBe(false);
  });

  it('크롬이 반납을 거절해 권한이 남으면 알리고, 설정은 꺼진 채로 둔다', async () => {
    await signIn();
    (chrome.permissions.remove as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      throw new Error('cannot remove required permission');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await disableTabSnapshots()).toBe(false);
    expect(permissionGranted).toBe(true);
    expect((await getSettings()).tabSnapshotsEnabled).toBe(false);
    expect(warn).toHaveBeenCalled();
    expect(await captureVisibleTab(WINDOW)).toBe(false);
  });

  it('반납이 되면 true', async () => {
    await signIn();
    expect(await disableTabSnapshots()).toBe(true);
  });

  it('크롬 설정에서 사이트 접근을 거두면(onRemoved) 미리보기 설정도 끈다', async () => {
    await signIn();
    let listener: ((p: chrome.permissions.Permissions) => void) | undefined;
    (chrome.permissions as unknown as { onRemoved: unknown }).onRemoved = {
      addListener: (fn: typeof listener) => (listener = fn),
    };
    initTabCapture();
    listener!({ origins: ['https://other.example/*'] });
    await new Promise((r) => setTimeout(r, 20));
    expect((await getSettings()).tabSnapshotsEnabled).toBe(true);
    listener!({ origins: ['<all_urls>'] });
    await new Promise((r) => setTimeout(r, 20));
    expect((await getSettings()).tabSnapshotsEnabled).toBe(false);
    await putSnapshot(USER, PAGE, 'data:a');
    expect(await fetchTabSnapshots([PAGE])).toEqual({});
  });

  it('끄면 이미 찍은 사진도 화면에 내주지 않는다(지우지는 않는다)', async () => {
    await signIn();
    await putSnapshot(USER, PAGE, 'data:a');
    expect(await fetchTabSnapshots([PAGE])).toEqual({ [PAGE]: 'data:a' });
    await disableTabSnapshots();
    expect(await fetchTabSnapshots([PAGE])).toEqual({});
    expect(await saved()).toBe('data:a');
  });

  it('명시적 로그아웃은 그 계정 사진만 바로 지운다', async () => {
    await signIn();
    await putSnapshot(USER, PAGE, 'data:a');
    await putSnapshot('user-b', PAGE, 'data:b');
    (chrome as unknown as { identity: unknown }).identity = {
      getAuthToken: vi.fn((_opts: unknown, cb: (r: unknown) => void) => cb(undefined)),
      removeCachedAuthToken: vi.fn(async () => undefined),
    };
    await signOut();
    expect(await saved()).toBeUndefined();
    expect(await saved(PAGE, 'user-b')).toBe('data:b');
  });
});

function urls(n: number) {
  return Array.from({ length: n }, (_, i) => `https://example.com/p${i}`);
}
