// 사진이 없는 페이지(미리보기를 켜기 전의 지난 기록)에 대표 이미지(og:image·twitter:image)를 받아 카드에 쓴다.
// 탭 캡처와 같은 규칙을 따른다: 미리보기 켜짐 + <all_urls> 권한 + 지금 계정의 현재 버전 수집 동의 + 같은 주소 판정
// (`canSnapshotUrl`: 민감·로그인·결제·메일·메신저·검색 결과 제외). 쿠키를 싣지 않고(credentials: 'omit') 받아
// 그 사이트에 로그인한 사람의 화면이 아니라 누구나 보는 공개 이미지만 얻는다. 결과는 기기 안 같은 저장소에 둔다.

import { getSession } from './auth';
import { getSettings, hasCollectionConsent } from './settings';
import { canSnapshotUrl, shrinkToJpeg } from './tab-capture';
import { hasSnapshotPermission, putSnapshot, snapshotKey } from './tab-snapshots';

const TIMEOUT_MS = 8000;
/** 대표 이미지 태그는 <head> 앞쪽에 있다. 큰 문서를 끝까지 읽지 않는다. */
const MAX_HTML_CHARS = 300_000;
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

async function getWithoutCookies(url: string): Promise<Response | null> {
  try {
    const res = await fetch(url, { credentials: 'omit', redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

/** 그 페이지의 대표 이미지를 400px JPEG data URL 로. 판정에 걸리거나 없거나 실패하면 null. */
export async function fetchPreviewImage(pageUrl: string): Promise<string | null> {
  if (!canSnapshotUrl(pageUrl)) return null;
  const page = await getWithoutCookies(pageUrl);
  // 리다이렉트로 로그인·민감 화면에 닿았으면 그 문서는 쓰지 않는다.
  if (!page || !canSnapshotUrl(page.url || pageUrl)) return null;
  if (!(page.headers.get('content-type') ?? '').includes('text/html')) return null;
  const imageUrl = findPreviewImageUrl((await page.text()).slice(0, MAX_HTML_CHARS), page.url || pageUrl);
  if (!imageUrl || !canSnapshotUrl(imageUrl)) return null;
  const image = await getWithoutCookies(imageUrl);
  if (!image || !(image.headers.get('content-type') ?? '').startsWith('image/')) return null;
  try {
    return await shrinkToJpeg(await image.blob());
  } catch {
    return null;
  }
}

/** 지금 이 기기에서 대표 이미지를 받아도 되는 계정. 안 되면 null. */
async function allowedAccount(): Promise<string | null> {
  if (!(await getSettings()).tabSnapshotsEnabled) return null;
  const session = await getSession();
  if (!session || !(await hasCollectionConsent(session.user.id))) return null;
  return (await hasSnapshotPermission()) ? session.user.id : null;
}

// ponytail: 한 화면(확장 페이지) 안의 줄. 새 탭을 여러 개 띄우면 탭마다 따로 돈다 — 문제가 되면 SW 로 옮긴다.
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
 * 화면에서 한 번만 시도한다. 저장할 때마다 `onSaved(정규화 URL, 사진)` 을 부른다. 요청을 시작하기 직전에
 * 매번 다시 판정하므로, 줄을 서 있는 사이 미리보기를 끄거나 계정을 바꾸면 그 뒤 요청은 나가지 않는다.
 */
export async function fillMissingPreviews(
  pageUrls: readonly string[],
  onSaved: (key: string, dataUrl: string) => void,
): Promise<void> {
  const accountId = await allowedAccount();
  if (!accountId) return;
  for (const url of pageUrls) {
    const key = snapshotKey(url);
    if (!key || !canSnapshotUrl(url) || tried.has(`${accountId}\n${key}`)) continue;
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
