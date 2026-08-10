/**
 * 열린 탭 미리보기 썸네일.
 *
 * `chrome.tabs.captureVisibleTab` 은 **활성 탭 하나**만 찍을 수 있다. 모든 탭을 찍으려면
 * 탭을 하나씩 실제로 활성화해야 해서 화면이 깜빡이므로, 사용자가 탭을 볼 때 조용히 찍어
 * 캐시하는 방식을 쓴다. 아직 안 찍힌 탭은 미리보기 대신 파비콘 카드로 그린다.
 */

const STORAGE_KEY = 'orbit:tabThumbs';
/** 저장 용량을 위해 최근 것만 남긴다. */
const MAX_ENTRIES = 24;
/** 캡처는 초당 호출 한도가 있어 최소 간격을 둔다. */
const MIN_CAPTURE_INTERVAL_MS = 1_500;
const THUMB_WIDTH = 320;

export interface TabThumbnail {
  /** 찍을 당시의 주소 — 탭이 다른 곳으로 이동했으면 재사용하지 않는다. */
  url: string;
  /** JPEG data URL */
  image: string;
  capturedAt: number;
}

export type TabThumbnailMap = Record<string, TabThumbnail>;

export async function getTabThumbnails(): Promise<TabThumbnailMap> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return {};
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const raw = stored[STORAGE_KEY];
    return raw && typeof raw === 'object' ? (raw as TabThumbnailMap) : {};
  } catch {
    return {};
  }
}

/** 오래된 항목을 잘라낸다. 순수 함수라 저장 없이 검증할 수 있다. */
export function pruneThumbnails(map: TabThumbnailMap, max = MAX_ENTRIES): TabThumbnailMap {
  const entries = Object.entries(map);
  if (entries.length <= max) return map;
  entries.sort((left, right) => right[1].capturedAt - left[1].capturedAt);
  return Object.fromEntries(entries.slice(0, max));
}

/** 다시 찍어야 하는지 — 주소가 달라졌거나 아직 없을 때만 찍는다. */
export function needsCapture(map: TabThumbnailMap, tabId: number, url: string): boolean {
  const existing = map[String(tabId)];
  return !existing || existing.url !== url;
}

/** 캡처 대상인 주소인지. 확장 페이지와 크롬 내부 페이지는 찍을 수 없다. */
export function isCapturableUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * 뷰포트 전체 JPEG 을 카드 크기로 줄인다.
 * 원본은 화면 해상도만큼 커서 그대로 저장하면 저장소를 금방 채운다.
 */
async function downscale(dataUrl: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(THUMB_WIDTH / bitmap.width, 1);
  const width = Math.max(Math.round(bitmap.width * scale), 1);
  const height = Math.max(Math.round(bitmap.height * scale), 1);

  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) return dataUrl;
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const resized = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.6 });
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(resized);
  });
}

let lastCaptureAt = 0;

/**
 * 지금 보이는 탭을 찍어 캐시한다. 서비스 워커에서만 부른다.
 * 실패(권한 없음·보호된 페이지·한도 초과)는 정상 범위라 조용히 넘긴다.
 */
export async function captureActiveTab(tabId: number, windowId: number, url: string): Promise<void> {
  if (!isCapturableUrl(url)) return;

  const now = Date.now();
  if (now - lastCaptureAt < MIN_CAPTURE_INTERVAL_MS) return;

  const map = await getTabThumbnails();
  if (!needsCapture(map, tabId, url)) return;

  lastCaptureAt = now;
  try {
    const raw = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 55 });
    if (!raw) return;
    const image = await downscale(raw);
    const next = pruneThumbnails({
      ...map,
      [String(tabId)]: { url, image, capturedAt: Date.now() },
    });
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
  } catch {
    // 캡처 불가 — 미리보기는 파비콘 카드로 대체된다.
  }
}

/** 닫힌 탭의 썸네일을 지운다. */
export async function forgetTabThumbnail(tabId: number): Promise<void> {
  const map = await getTabThumbnails();
  const key = String(tabId);
  if (!(key in map)) return;
  const { [key]: _removed, ...rest } = map;
  await chrome.storage.local.set({ [STORAGE_KEY]: rest });
}
