import type { PageContent, TabItem } from './types';

// chrome.* API 래퍼. 사이드패널(확장 페이지)에서 직접 호출합니다.
// dev 환경에서 chrome 이 없으면 빈 배열을 반환해 UI 가 안전하게 동작합니다.

function hasTabsApi(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.tabs?.query;
}

export async function getCurrentWindowTabs(): Promise<TabItem[]> {
  if (!hasTabsApi()) return [];
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return tabs
    .filter((t) => {
      const url = t.url || t.pendingUrl || '';
      // id가 없는 탭(devtools 등)은 제외 — parseInt(tabItem.id) 항상 유효하도록
      return t.id !== undefined && url && !url.startsWith('chrome://') && !url.startsWith('chrome-extension://');
    })
    .map((t) => ({
      id: String(t.id!),
      title: t.title?.trim() || '(로딩 중…)',
      url: t.url || t.pendingUrl || '',
      favIconUrl: t.favIconUrl,
    }));
}

export async function getTabPageContent(tabId: number): Promise<PageContent | null> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return null;
  try {
    return await chrome.runtime.sendMessage({ type: 'GET_PAGE_CONTENT', tabId });
  } catch {
    return null;
  }
}

export async function restoreInCurrentWindow(urls: string[]): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.create) return;
  for (const url of urls) {
    await chrome.tabs.create({ url, active: false });
  }
}

export async function restoreInNewWindow(urls: string[]): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.windows?.create) return;
  if (urls.length === 0) return;
  await chrome.windows.create({ url: urls });
}

export async function openTabs(urls: string[]): Promise<void> {
  await restoreInNewWindow(urls);
}
