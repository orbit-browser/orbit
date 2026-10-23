// 사진이 없는 페이지(미리보기를 켜기 전의 지난 기록)에 대표 이미지(og:image·twitter:image)를 받아 카드에 쓴다.
// 사용자가 예전에 연 주소를 조작 없이 다시 여는 일이라(보안 검토 2026-10-23 M1) 부작용이 있을 수 있는 주소는 열지 않는다:
//   - 캡처와 같은 판정(`canSnapshotUrl`: 민감·로그인·결제·메일·메신저·검색 결과)
//   - 쿼리가 있는 주소(1회용 토큰·코드가 실리는 곳). 유튜브 영상만 예외 — 페이지를 열지 않고 영상 id 로 썸네일을 바로 받는다
//   - 루프백·사설·링크로컬·`.local`·`.internal`·점 없는 이름·IP 리터럴 호스트(공유기·개발 서버의 GET 동작)
//   - 경로에 reset·verify·invite·unsubscribe·callback·token·oauth 같은 조각이 있는 주소
//   - 리다이렉트가 생기면 버린다(`redirect: 'manual'`) — 중간 홉을 다시 판정할 수 없다
// 쿠키·인증을 싣지 않고(credentials: 'omit'), Referer 도 보내지 않는다. HTML 은 앞 300KB, 이미지는 2MB 까지만 읽는다.
// 받는 줄은 서비스 워커 한 곳에 있다 — 새 탭을 여러 개 열어도 동시 2개·초당 2개를 넘지 않는다.

import { getSession } from './auth';
import { getSettings, hasCollectionConsent } from './settings';
import { canSnapshotUrl, shrinkToJpeg } from './tab-capture';
import { hasSnapshotPermission, putSnapshot, snapshotKey } from './tab-snapshots';

const TIMEOUT_MS = 8000;
export const MAX_HTML_BYTES = 300 * 1024;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_CONCURRENT = 2;
/** 요청 시작 간격 하한 — 초당 2개 이하. */
const MIN_START_GAP_MS = 500;
/**
 * 대표 이미지는 찍은 시각 0 으로 둔다. 그러면 상한 정리에서 가장 먼저 지워지고, 그 페이지를 실제로 열면
 * 탭 캡처의 "같은 페이지 10분" 제한에 걸리지 않고 실제 화면으로 바뀐다.
 */
export const PREVIEW_IMAGE_CAPTURED_AT = 0;

const META_PATTERNS = [
  /<meta[^>]+(?:property|name)=["']og:image(?::secure_url)?["'][^>]*>/i,
  /<meta[^>]+(?:property|name)=["']twitter:image(?::src)?["'][^>]*>/i,
];

const SIDE_EFFECT_SEGMENT =
  /(^|[/._-])(reset|verify|verification|confirm|invite|unsubscribe|magic|callback|token|activate|oauth|login|signin|logout|signout)([/._-]|$)/i;

/** 다시 열면 남의 기기·내부망에 닿을 수 있는 호스트. IP 리터럴은 모두 막는다(사설·루프백·링크로컬 포함). */
export function isLocalOrPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, '');
  if (!host.includes('.')) return true; // localhost·사내 단일 이름
  if (host.startsWith('[') || host.includes(':')) return true; // IPv6
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true; // IPv4
  if (/\.(local|internal|localhost|lan|home|corp|intranet)$/.test(host)) return true;
  // 공개 이름이지만 DNS가 사설·루프백 주소를 돌려주는 잘 알려진 도메인(확장에서는 DNS 해석을 할 수 없다).
  return /(^|\.)(nip\.io|sslip\.io|localtest\.me|lvh\.me)$/.test(host);
}

function decodedPath(url: URL): string {
  try {
    return decodeURIComponent(url.pathname);
  } catch {
    return url.pathname;
  }
}

function hasSideEffectPath(url: URL): boolean {
  return SIDE_EFFECT_SEGMENT.test(decodedPath(url));
}

/** 유튜브 영상 주소면 영상 id. 아니면 null. */
export function youtubeVideoId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  const id =
    host === 'youtu.be'
      ? url.pathname.slice(1).split('/')[0]
      : ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host) && url.pathname === '/watch'
        ? url.searchParams.get('v')
        : null;
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

export type PreviewSource = { kind: 'image'; imageUrl: string } | { kind: 'page'; pageUrl: string };

/** 이 페이지의 대표 이미지를 어디서 받을지. 열면 안 되는 주소면 null(요청하지 않는다). */
export function previewSourceFor(rawUrl: string): PreviewSource | null {
  if (!canSnapshotUrl(rawUrl)) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const videoId = youtubeVideoId(url);
  if (videoId) return { kind: 'image', imageUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` };
  if (url.search || url.username || url.password) return null;
  if (isLocalOrPrivateHost(url.hostname) || hasSideEffectPath(url)) return null;
  url.hash = '';
  return { kind: 'page', pageUrl: url.href };
}

/** 대표 이미지 주소도 같은 호스트·경로 판정을 거친다(이미지 CDN 의 크기 조절 쿼리는 허용한다). */
function isFetchableImageUrl(rawUrl: string): boolean {
  if (!canSnapshotUrl(rawUrl)) return false;
  try {
    const url = new URL(rawUrl);
    return !url.username && !url.password && !isLocalOrPrivateHost(url.hostname) && !hasSideEffectPath(url);
  } catch {
    return false;
  }
}

/** 문서에서 대표 이미지 주소를 찾는다(상대 주소는 페이지 기준으로 푼다). 없으면 null. */
export function findPreviewImageUrl(html: string, pageUrl: string): string | null {
  for (const pattern of META_PATTERNS) {
    const tag = pattern.exec(html)?.[0];
    const content = tag && /content=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!content) continue;
    try {
      const resolved = new URL(content.replace(/&amp;/g, '&'), pageUrl);
      if (/^https?:$/.test(resolved.protocol)) return resolved.href;
    } catch {
      // 깨진 주소는 다음 후보로
    }
  }
  return null;
}

/** 쿠키·인증·Referer 없이, 리다이렉트를 따라가지 않고 받는다. 리다이렉트·오류면 null. */
export const PREVIEW_FETCH_INIT: RequestInit = {
  credentials: 'omit',
  redirect: 'manual',
  referrerPolicy: 'no-referrer',
  cache: 'no-store',
};

async function get(url: string): Promise<Response | null> {
  try {
    const res = await fetch(url, { ...PREVIEW_FETCH_INIT, signal: AbortSignal.timeout(TIMEOUT_MS) });
    // redirect: 'manual' 의 리다이렉트는 opaqueredirect(status 0)로 온다 — ok 가 아니라 버려진다.
    return res.ok && res.type !== 'opaqueredirect' ? res : null;
  } catch {
    return null;
  }
}

/**
 * 본문을 `limit` 바이트까지만 읽는다. `truncate` 면 넘는 부분을 버리고 앞부분을 돌려주고, 아니면 넘을 때 null.
 * 다 받은 뒤 자르지 않고 스트림을 끊는다(큰 문서·이미지를 메모리에 올리지 않게).
 */
export async function readLimited(res: Response, limit: number, truncate: boolean): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(res.headers.get('content-length'));
  if (!truncate && declared > limit) return null;
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.length > limit) {
      await reader.cancel().catch(() => undefined);
      if (!truncate) return null;
      chunks.push(value.subarray(0, limit - total));
      total = limit;
      break;
    }
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function fetchImage(imageUrl: string): Promise<string | null> {
  if (!isFetchableImageUrl(imageUrl)) return null;
  const res = await get(imageUrl);
  const type = res?.headers.get('content-type') ?? '';
  if (!res || !type.startsWith('image/')) return null;
  const bytes = await readLimited(res, MAX_IMAGE_BYTES, false);
  if (!bytes) return null;
  try {
    return await shrinkToJpeg(new Blob([bytes], { type }));
  } catch {
    return null;
  }
}

/** 그 페이지의 대표 이미지를 400px JPEG data URL 로. 판정에 걸리거나 없거나 실패하면 null. */
export async function fetchPreviewImage(rawUrl: string): Promise<string | null> {
  const source = previewSourceFor(rawUrl);
  if (!source) return null;
  if (source.kind === 'image') return fetchImage(source.imageUrl);
  const page = await get(source.pageUrl);
  if (!page || !(page.headers.get('content-type') ?? '').includes('text/html')) return null;
  const head = await readLimited(page, MAX_HTML_BYTES, true);
  if (!head) return null;
  const imageUrl = findPreviewImageUrl(new TextDecoder().decode(head), source.pageUrl);
  return imageUrl ? fetchImage(imageUrl) : null;
}

/** 지금 이 기기에서 대표 이미지를 받아도 되는 계정. 안 되면 null. */
async function allowedAccount(): Promise<string | null> {
  const settings = await getSettings();
  if (!settings.tabSnapshotsEnabled || !settings.pageImageFallbackEnabled) return null;
  const session = await getSession();
  if (!session || !(await hasCollectionConsent(session.user.id))) return null;
  return (await hasSnapshotPermission()) ? session.user.id : null;
}

const tried = new Set<string>();
const queue: (() => Promise<void>)[] = [];
let running = 0;
let lastStart = 0;

function pump(): void {
  while (running < MAX_CONCURRENT && queue.length > 0) {
    const wait = lastStart + MIN_START_GAP_MS - Date.now();
    if (wait > 0) {
      setTimeout(pump, wait);
      return;
    }
    const job = queue.shift()!;
    running += 1;
    lastStart = Date.now();
    void job().finally(() => {
      running -= 1;
      pump();
    });
  }
}

/** 시험용 — 줄과 시도 기록을 비운다. */
export function resetPreviewQueue(): void {
  tried.clear();
  queue.length = 0;
  running = 0;
  lastStart = 0;
}

/**
 * 사진이 없는 페이지들의 대표 이미지를 주어진 순서(보이는 카드부터)로 천천히 받아 저장한다. 한 페이지는 이
 * SW 수명 동안 한 번만 시도한다. 저장할 때마다 `onSaved(정규화 URL, 사진)` 을 부른다. 요청을 시작하기 직전과
 * 저장하기 직전에 매번 다시 판정하므로, 줄을 서 있는 사이 미리보기를 끄거나 계정을 바꾸면 그 뒤는 나가지 않는다.
 */
export async function fillMissingPreviews(
  pageUrls: readonly string[],
  onSaved: (key: string, dataUrl: string) => void,
): Promise<void> {
  const accountId = await allowedAccount();
  if (!accountId) return;
  for (const url of pageUrls) {
    const key = snapshotKey(url);
    if (!key || !previewSourceFor(url) || tried.has(`${accountId}\n${key}`)) continue;
    tried.add(`${accountId}\n${key}`);
    queue.push(async () => {
      if ((await allowedAccount()) !== accountId) return;
      const dataUrl = await fetchPreviewImage(url);
      if (!dataUrl || (await allowedAccount()) !== accountId) return;
      await putSnapshot(accountId, url, dataUrl, PREVIEW_IMAGE_CAPTURED_AT);
      onSaved(key, dataUrl);
    });
  }
  pump();
}

// ── 화면 ↔ 서비스 워커 ──────────────────────────────────────────────

export const FILL_PREVIEWS_MESSAGE = 'FILL_PREVIEWS';
export const PREVIEW_SAVED_MESSAGE = 'PREVIEW_SAVED';

/** SW 쪽: 화면이 보낸 "사진 없는 페이지" 목록을 한 줄에 세우고, 저장될 때마다 모든 화면에 알린다. */
export function initPagePreviews(): void {
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.type !== FILL_PREVIEWS_MESSAGE || !Array.isArray(message.urls)) return false;
    // 확장 화면(새 탭·사이드패널)만 부탁할 수 있다. content script(웹 페이지 안)의 메시지로 주소를 열게 두지 않는다.
    if (!sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
    const urls = (message.urls as unknown[]).filter((u): u is string => typeof u === 'string').slice(0, 200);
    void fillMissingPreviews(urls, (key, dataUrl) => {
      chrome.runtime.sendMessage({ type: PREVIEW_SAVED_MESSAGE, key, dataUrl }).catch(() => undefined);
    }).catch((err) => console.warn('[Orbit] page preview fill failed', err));
    return false;
  });
}
