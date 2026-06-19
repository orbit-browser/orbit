import type { TabItem } from './types';

// chrome.* API 래퍼. 사이드패널(확장 페이지)에서 직접 호출합니다.
// dev 환경에서 chrome 이 없으면 빈 배열을 반환해 UI 가 안전하게 동작합니다.

function hasTabsApi(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.tabs?.query;
}

export async function getCurrentWindowTabs(): Promise<TabItem[]> {
  if (!hasTabsApi()) return [];
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return tabs
    .filter((t) => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://'))
    .map((t) => ({
      id: String(t.id ?? t.index),
      title: t.title?.trim() || '(제목 없음)',
      url: t.url ?? '',
      favIconUrl: t.favIconUrl,
    }));
}

export async function openTabs(urls: string[]): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.create) return;
  for (const url of urls) {
    await chrome.tabs.create({ url, active: false });
  }
}
