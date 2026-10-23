// 지난 기록의 대표 이미지(og:image): 쿠키 없이, 캡처와 같은 판정으로, 켜져 있을 때만, 지금 계정에, 천천히.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { CONSENT_VERSION } from '../../lib/settings';
import {
  FILL_PREVIEWS_MESSAGE,
  initPagePreviews,
  isLocalOrPrivateHost,
  MAX_HTML_BYTES,
  MAX_IMAGE_BYTES,
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
  init?: RequestInit;
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
      calls.push({ url, credentials: init?.credentials, init });
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

describe('다시 열면 부작용이 있을 수 있는 주소는 요청하지 않는다 (보안 검토 M1)', () => {
  it.each([
    ['쿼리(1회용 토큰)', 'https://app.example.com/welcome?token=abc'],
    ['쿼리(일반)', 'https://blog.example.com/post?id=3'],
    ['루프백', 'http://localhost:3000/admin'],
    ['루프백 IP', 'http://127.0.0.1:8000/sessions'],
    ['사설 IP', 'http://192.168.0.1/reboot.cgi'],
    ['사설 IP 10.x', 'http://10.1.2.3/page'],
    ['링크로컬', 'http://169.254.169.254/latest/meta-data'],
    ['IPv6', 'http://[::1]/x'],
    ['.local', 'http://printer.local/status'],
    ['.internal', 'https://wiki.corp.internal/page'],
    ['private DNS name', 'http://10.0.0.1.nip.io/admin'],
    ['loopback DNS name', 'http://app.localtest.me/'],
    ['점 없는 이름', 'http://intranet/home'],
    ['비밀번호 재설정', 'https://example.com/reset-password/abc123'],
    ['이메일 확인', 'https://example.com/verify/abc'],
    ['초대', 'https://example.com/invite/xyz'],
    ['구독 해지', 'https://news.example.com/unsubscribe/42'],
    ['OAuth 콜백', 'https://example.com/oauth/callback'],
    ['매직 링크', 'https://example.com/magic/link'],
    ['토큰 경로', 'https://example.com/token/abc'],
    ['로그인 경로(signin)', 'https://example.com/signin'],
    ['확인', 'https://example.com/confirm-email'],
  ])('%s: fetch 가 불리지 않는다', async (_label, url) => {
    expect(await fetchPreviewImage(url)).toBeNull();
    expect(calls).toEqual([]);
  });

  it('호스트 판정', () => {
    expect(isLocalOrPrivateHost('blog.example.com')).toBe(false);
    expect(isLocalOrPrivateHost('LOCALHOST')).toBe(true);
    expect(isLocalOrPrivateHost('172.16.0.1')).toBe(true);
  });

  it('유튜브 영상은 페이지를 열지 않고 영상 id 의 썸네일만 받는다', async () => {
    installFetch({ 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg': () => new Response(new Blob(['y']), { headers: { 'content-type': 'image/jpeg' } }) });
    expect(await fetchPreviewImage('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1')).not.toBeNull();
    expect(await fetchPreviewImage('https://youtu.be/dQw4w9WgXcQ?t=10')).not.toBeNull();
    expect(calls.map((c) => c.url)).toEqual([
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    ]);
  });

  it('쿠키·Referer 없이, 리다이렉트를 따라가지 않게 요청한다', async () => {
    await fetchPreviewImage(PAGE);
    for (const call of calls) {
      expect(call.init).toMatchObject({ credentials: 'omit', redirect: 'manual', referrerPolicy: 'no-referrer' });
    }
  });

  it('리다이렉트가 오면 버리고 다음 요청을 하지 않는다', async () => {
    installFetch({ [PAGE]: () => new Response(null, { status: 302, headers: { location: 'http://192.168.0.1/' } }) });
    expect(await fetchPreviewImage(PAGE)).toBeNull();
    // 브라우저의 redirect: 'manual' 은 본문을 감춘 opaqueredirect 로 준다. 그 응답은 내용이 있어 보여도 쓰지 않는다.
    installFetch({
      [PAGE]: () => {
        const res = html(`<meta property="og:image" content="${IMAGE}">`);
        Object.defineProperty(res, 'type', { value: 'opaqueredirect' });
        return res;
      },
    });
    expect(await fetchPreviewImage(PAGE)).toBeNull();
    expect(calls.map((c) => c.url)).toEqual([PAGE, PAGE]);
  });

  it('대표 이미지 주소가 사설망이면 그 이미지는 요청하지 않는다', async () => {
    installFetch({ [PAGE]: () => html('<meta property="og:image" content="http://10.0.0.5/pixel.png">') });
    expect(await fetchPreviewImage(PAGE)).toBeNull();
    expect(calls.map((c) => c.url)).toEqual([PAGE]);
  });
});

describe('크기 상한', () => {
  it(`HTML 은 앞 ${MAX_HTML_BYTES / 1024}KB 만 읽는다 — 그 뒤의 태그는 보지 않고 스트림을 끊는다`, async () => {
    let cancelled = false;
    const filler = new TextEncoder().encode('x'.repeat(64 * 1024));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 10) {
          controller.enqueue(new TextEncoder().encode(`<meta property="og:image" content="${IMAGE}">`));
          controller.close();
          return;
        }
        sent += 1;
        controller.enqueue(filler);
      },
      cancel() {
        cancelled = true;
      },
    });
    installFetch({ [PAGE]: () => new Response(body, { headers: { 'content-type': 'text/html' } }) });
    expect(await fetchPreviewImage(PAGE)).toBeNull();
    expect(cancelled).toBe(true);
    expect(sent).toBeLessThan(10);
    expect(calls.map((c) => c.url)).toEqual([PAGE]);
  });

  it('이미지는 2MB 를 넘으면 버린다(Content-Length·스트림 모두)', async () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    installFetch({
      [IMAGE]: () => new Response(big, { headers: { 'content-type': 'image/jpeg', 'content-length': String(big.length) } }),
    });
    expect(await fetchPreviewImage(PAGE)).toBeNull();
    installFetch({
      [IMAGE]: () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(big);
              c.close();
            },
          }),
          { headers: { 'content-type': 'image/jpeg' } },
        ),
    });
    expect(await fetchPreviewImage(PAGE)).toBeNull();
  });
});

describe('보충만 끄기와 서비스 워커 줄', () => {
  it('"지난 페이지 대표 이미지 받기"를 끄면 요청 0(캡처는 그대로)', async () => {
    await signIn(USER, { pageImageFallbackEnabled: false });
    await fillMissingPreviews([PAGE], () => undefined);
    await flush();
    expect(calls).toEqual([]);
  });

  it('확장 화면의 부탁만 받는다 — 웹 페이지(content script)가 보낸 목록으로는 요청하지 않는다', async () => {
    await signIn();
    let listener!: (m: unknown, s: chrome.runtime.MessageSender) => void;
    vi.spyOn(chrome.runtime.onMessage, 'addListener').mockImplementation(((fn: typeof listener) => {
      listener = fn;
    }) as never);
    vi.spyOn(chrome.runtime, 'sendMessage').mockResolvedValue(undefined as never);
    initPagePreviews();
    listener({ type: FILL_PREVIEWS_MESSAGE, urls: [PAGE] }, { url: 'https://evil.example/', tab: { id: 1 } as chrome.tabs.Tab });
    await flush();
    expect(calls).toEqual([]);
    listener({ type: FILL_PREVIEWS_MESSAGE, urls: [PAGE] }, { url: chrome.runtime.getURL('/newtab.html') });
    await flush();
    expect(calls.map((c) => c.url)).toEqual([PAGE, IMAGE]);
  });
});
