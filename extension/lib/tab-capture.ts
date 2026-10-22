// 탭 화면 미리보기 찍기 — 페이지가 화면에 뜰 때 페이지당 한 번(다시 오면 10분 뒤 갱신).
// 크롬은 창에 보이는 탭만 찍을 수 있다(`tabs.captureVisibleTab`, `<all_urls>` 호스트 권한 필요).
// 찍지 않는 곳: 민감 사이트, 로그인·결제 화면, 웹메일·메신저·검색 결과, 시크릿 창, 수집 동의가 없거나 옛 버전인 계정, 내부 페이지.
// 찍는 일이 브라우징을 막아서는 안 되므로 실패는 모두 삼킨다(fail-open, 저장만 건너뛴다).

import { getSession } from './auth';
import { getSettings, hasCollectionConsent } from './settings';
import { isTeamBlockedUrl } from './sensitive-domains';
import { putSnapshot, snapshotCapturedAt } from './tab-snapshots';

/** 같은 페이지는 이 간격 안에 다시 찍지 않는다. */
export const SAME_PAGE_INTERVAL_MS = 10 * 60 * 1000;
/** 전체 찍기 간격 하한(크롬 자체 한도는 초당 2회). */
export const MIN_CAPTURE_GAP_MS = 1000;
/** 그려질 시간을 준다 — 탭을 바꾸거나 로드가 끝난 바로 그 순간은 앞 화면이 남아 있을 수 있다. */
const SETTLE_DELAY_MS = 700;
const SNAPSHOT_WIDTH = 400;
const SNAPSHOT_QUALITY = 0.6;

let lastCaptureAt = 0;
let chain: Promise<unknown> = Promise.resolve();

/** 시험용 — 모듈 상태(마지막 찍은 시각)를 비운다. */
export function resetCaptureThrottle(): void {
  lastCaptureAt = 0;
}

/**
 * 이 주소의 화면을 찍어도 되는가(주소만으로 판정할 수 있는 부분). 팀 수집 기본 제외와 같은 표를 쓴다 —
 * 민감 사이트·로그인·결제에 더해 웹메일·메신저·검색 결과 페이지도 찍지 않는다(CTO 2026-10-23, 서버
 * `is_team_blocked_url` 과 같은 목록). 사용자 제외 목록은 팀 수집 전용이라 넘기지 않는다.
 */
export function canSnapshotUrl(url: string | undefined): url is string {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  return !isTeamBlockedUrl(url);
}

async function activeTabOf(windowId: number): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  return tab;
}

/** data URL → 400px 폭 JPEG data URL. 서비스 워커에는 DOM 이 없어 OffscreenCanvas 를 쓴다. */
async function shrinkToJpeg(dataUrl: string): Promise<string> {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const width = Math.min(SNAPSHOT_WIDTH, bitmap.width);
  const height = Math.max(1, Math.round((bitmap.height * width) / bitmap.width));
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: SNAPSHOT_QUALITY });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

/**
 * 그 창에 지금 보이는 탭을 찍어 지금 계정의 미리보기로 저장한다. 저장했으면 true.
 * 찍는 사이 탭이 바뀌면 다른 페이지 화면이 이 주소로 저장될 수 있어, 찍은 뒤 같은 탭·주소·계정인지
 * 다시 보고 다르면 버린다.
 */
export async function captureVisibleTab(windowId: number): Promise<boolean> {
  const settings = await getSettings();
  if (!settings.tabSnapshotsEnabled) return false;
  const session = await getSession();
  if (!session) return false;
  const accountId = session.user.id;
  if (!(await hasCollectionConsent(accountId))) return false;

  const tab = await activeTabOf(windowId);
  if (!tab || tab.incognito || tab.status !== 'complete' || !canSnapshotUrl(tab.url)) return false;
  const url = tab.url;

  const now = Date.now();
  const previous = await snapshotCapturedAt(accountId, url);
  if (previous !== null && now - previous < SAME_PAGE_INTERVAL_MS) return false;
  if (now - lastCaptureAt < MIN_CAPTURE_GAP_MS) return false;
  lastCaptureAt = now;

  const raw = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 80 });
  const after = await activeTabOf(windowId);
  if (!after || after.id !== tab.id || after.url !== url) return false;
  if ((await getSession())?.user.id !== accountId) return false;

  await putSnapshot(accountId, url, await shrinkToJpeg(raw), now);
  return true;
}

const timers = new Map<number, ReturnType<typeof setTimeout>>();

/** 창마다 마지막 요청 하나만 남겨, 화면이 자리 잡은 뒤 한 줄로 찍는다. */
function scheduleCapture(windowId: number): void {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  clearTimeout(timers.get(windowId));
  timers.set(
    windowId,
    setTimeout(() => {
      timers.delete(windowId);
      chain = chain
        .then(() => captureVisibleTab(windowId))
        .catch((err) => console.warn('[Orbit] tab snapshot skipped', err));
    }, SETTLE_DELAY_MS),
  );
}

/** SW 최초 tick 에 동기적으로 리스너를 건다(collector 와 같은 이유). */
export function initTabCapture(): void {
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.active) scheduleCapture(tab.windowId);
  });
  chrome.tabs.onActivated.addListener(({ windowId }) => scheduleCapture(windowId));
  chrome.windows.onFocusChanged.addListener((windowId) => scheduleCapture(windowId));
}
