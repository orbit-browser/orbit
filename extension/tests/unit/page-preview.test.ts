// 지난 기록의 대표 이미지(og:image): 쿠키 없이, 캡처와 같은 판정으로, 켜져 있을 때만, 지금 계정에, 천천히.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { CONSENT_VERSION } from '../../lib/settings';
import {
  fetchPreviewImage,
  fillMissingPreviews,
  findPreviewImageUrl,
  PREVIEW_IMAGE_CAPTURED_AT,
  resetPreviewQueue,
} from '../../lib/page-preview';
import { clearSnapshots, loadSnapshots, snapshotCapturedAt } from '../../lib/tab-snapshots';

const USER = 'user-a';
const PAGE = 'https://blog.example.com/post/1';
const IMAGE = 'https://cdn.example.com/cover.jpg';

interface Call {
  url: string;
  credentials: RequestCredentials | undefined;
}
let calls: Call[] = [];
let permission = true;

function html(meta: string) {
  return new Response(`<html><head>${meta}</head><body>hi</body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function installFetch(pages: Record<string, () => Response> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, credentials: init?.credentials });
      const page = pages[url];
      if (page) return page();
      if (url === PAGE) return html(`<meta property="og:image" content="${IMAGE}">`);
      if (url === IMAGE) return new Response(new Blob(['img'], { type: 'image/jpeg' }), { headers: { 'content-type': 'image/jpeg' } });
      return new Response('nope', { status: 404 });
    }),
  );
}

async function signIn(account = USER, settings: Record<string, unknown> = {}, consent: number | boolean = CONSENT_VERSION) {
  await chrome.storage.local.set({
    'orbit:auth': {
      token: 't',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      user: { id: account, email: `${account}@example.com`, name: account, picture: null },
    },
    'orbit:collectionConsent': { [account]: consent },
    'orbit:settings': { collectionEnabled: true, tabSnapshotsEnabled: true, ...settings },
  });
}

const flush = () => new Promise((r) => setTimeout(r, 30));

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  fakeBrowser.reset();
  resetPreviewQueue();
  await clearSnapshots(USER);
  await clearSnapshots('user-b');
  calls = [];
  permission = true;
  (chrome as unknown as { permissions: unknown }).permissions = { contains: vi.fn(async () => permission) };
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1200, height: 630, close: () => undefined })));
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
        return new Blob([`og ${this.width}x${this.height}`], { type: 'image/jpeg' });
      }
    },
  );
  installFetch();
});

describe('대표 이미지 찾기', () => {
  it('og:image, 없으면 twitter:image, 상대 주소는 페이지 기준', () => {
    expect(findPreviewImageUrl(`<meta content="/a.png" property="og:image">`, PAGE)).toBe('https://blog.example.com/a.png');
    expect(findPreviewImageUrl(`<meta name="twitter:image" content="https://x.example/t.jpg?a=1&amp;b=2">`, PAGE)).toBe(
      'https://x.example/t.jpg?a=1&b=2',
    );
    expect(findPreviewImageUrl('<title>none</title>', PAGE)).toBeNull();
    expect(findPreviewImageUrl(`<meta property="og:image" content="javascript:alert(1)">`, PAGE)).toBeNull();
  });
});

describe('받기', () => {
  it('페이지와 이미지를 쿠키 없이 받아 400px JPEG 로 줄인다', async () => {
    const dataUrl = await fetchPreviewImage(PAGE);
    expect(atob(dataUrl!.split(',')[1])).toBe('og 400x210');
    expect(calls.map((c) => c.url)).toEqual([PAGE, IMAGE]);
    expect(calls.every((c) => c.credentials === 'omit')).toBe(true);
  });

  it.each([
    ['민감 도메인', 'https://obank.kbstar.com/quics'],
    ['로그인', 'https://example.com/login'],
    ['결제', 'https://shop.example.com/checkout/1'],
    ['메일', 'https://mail.google.com/mail/u/0/'],
    ['메신저', 'https://app.slack.com/client/T1'],
    ['검색 결과', 'https://www.google.com/search?q=x'],
    ['내부 페이지', 'chrome://settings'],
  ])('%s는 요청하지 않는다', async (_label, url) => {
    expect(await fetchPreviewImage(url)).toBeNull();
    expect(calls).toEqual([]);
  });

  it('대표 이미지가 없거나 실패하면 null(카드는 회색 칸 그대로)', async () => {
    installFetch({ [PAGE]: () => html('<title>no image</title>') });
    expect(await fetchPreviewImage(PAGE)).toBeNull();
    installFetch({ [PAGE]: () => new Response('down', { status: 503 }) });
    expect(await fetchPreviewImage(PAGE)).toBeNull();
  });
});

describe('채우기 (켜짐·권한·동의·계정)', () => {
  it('지금 계정의 저장소에 찍은 시각 0 으로 넣는다(실제로 열면 캡처가 바꾼다)', async () => {
    await signIn();
    const saved: string[] = [];
    await fillMissingPreviews([PAGE], (key) => saved.push(key));
    await flush();
    expect(saved).toEqual([PAGE]);
    expect(Object.keys(await loadSnapshots(USER, [PAGE]))).toEqual([PAGE]);
    expect(await loadSnapshots('user-b', [PAGE])).toEqual({});
    expect(await snapshotCapturedAt(USER, PAGE)).toBe(PREVIEW_IMAGE_CAPTURED_AT);
  });

  it.each([
    ['미리보기 꺼짐', () => signIn(USER, { tabSnapshotsEnabled: false })],
    ['동의 없음', () => signIn(USER, {}, false)],
    ['옛 버전 동의', () => signIn(USER, {}, 1)],
    ['로그아웃', async () => undefined],
    [
      '권한 없음',
      async () => {
        await signIn();
        permission = false;
      },
    ],
  ])('%s이면 요청 0', async (_label, setup) => {
    await setup();
    await fillMissingPreviews([PAGE], () => undefined);
    await flush();
    expect(calls).toEqual([]);
  });

  it('줄을 서 있는 사이 계정이 바뀌면 남은 요청은 나가지 않는다', async () => {
    await signIn();
    const pages = Array.from({ length: 4 }, (_, i) => `https://blog.example.com/p${i}`);
    installFetch(Object.fromEntries(pages.map((p) => [p, () => html(`<meta property="og:image" content="${IMAGE}">`)])));
    await fillMissingPreviews(pages, () => undefined);
    await signIn('user-b');
    await new Promise((r) => setTimeout(r, 1500));
    // 처음 두 개(동시 상한)까지만 시작될 수 있다. 계정이 바뀐 뒤에는 새 요청이 없고, 아무것도 user-a 로 저장되지 않는다.
    expect(calls.filter((c) => pages.includes(c.url)).length).toBeLessThanOrEqual(2);
    expect(await loadSnapshots(USER, pages)).toEqual({});
  });

  it('받는 사이 계정이 바뀌면 그 이미지를 저장하지 않는다', async () => {
    await signIn();
    installFetch({
      [IMAGE]: () => {
        void signIn('user-b');
        return new Response(new Blob(['img'], { type: 'image/jpeg' }), { headers: { 'content-type': 'image/jpeg' } });
      },
    });
    const saved: string[] = [];
    await fillMissingPreviews([PAGE], (key) => saved.push(key));
    await flush();
    expect(saved).toEqual([]);
    expect(await loadSnapshots(USER, [PAGE])).toEqual({});
    expect(await loadSnapshots('user-b', [PAGE])).toEqual({});
  });

  it('동시 2개, 시작 간격 0.5초(초당 2개 이하), 같은 페이지는 다시 시도하지 않는다', async () => {
    await signIn();
    const pages = Array.from({ length: 4 }, (_, i) => `https://blog.example.com/q${i}`);
    const starts: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    installFetch(
      Object.fromEntries(
        pages.map((p) => [
          p,
          () => {
            starts.push(Date.now());
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            setTimeout(() => (inFlight -= 1), 300);
            return html('<title>none</title>');
          },
        ]),
      ),
    );
    await fillMissingPreviews(pages, () => undefined);
    await fillMissingPreviews(pages, () => undefined);
    await new Promise((r) => setTimeout(r, 2200));
    expect(starts).toHaveLength(4);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    for (let i = 1; i < starts.length; i += 1) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(480);
  });
});
