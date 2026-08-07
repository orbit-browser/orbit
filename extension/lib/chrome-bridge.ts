import type { OpenTabItem, PageContent, TabItem } from './types';
import { isBookmarkableUrl, uniqueBookmarkTabs } from './tab-actions';

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

export async function getAllOpenTabs(): Promise<OpenTabItem[]> {
  if (!hasTabsApi()) return [];
  const tabs = await chrome.tabs.query({ windowType: 'normal' });
  return tabs
    .filter((tab) => tab.id !== undefined && tab.windowId !== undefined && !tab.incognito)
    .map((tab) => {
      const url = tab.url || tab.pendingUrl || '';
      return {
        id: String(tab.id!),
        windowId: tab.windowId,
        index: tab.index,
        active: tab.active,
        title: tab.title?.trim() || '(로딩 중…)',
        url,
        favIconUrl: tab.favIconUrl,
        bookmarkable: isBookmarkableUrl(url),
      };
    })
    .sort((left, right) => left.windowId - right.windowId || left.index - right.index);
}

export async function activateOpenTab(tab: Pick<OpenTabItem, 'id' | 'windowId'>): Promise<void> {
  if (!hasTabsApi() || !chrome.windows?.update) {
    throw new Error('Chrome tabs API is unavailable');
  }
  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(Number(tab.id), { active: true });
}

export interface BookmarkTabsResult {
  createdCount: number;
  skippedCount: number;
  failedTabIds: string[];
}

export async function bookmarkOpenTabs(tabs: OpenTabItem[]): Promise<BookmarkTabsResult> {
  if (typeof chrome === 'undefined' || !chrome.bookmarks?.search || !chrome.bookmarks?.create) {
    throw new Error('Chrome bookmarks API is unavailable');
  }

  const candidates = uniqueBookmarkTabs(tabs);
  let createdCount = 0;
  let skippedCount = candidates.skippedCount;
  const failedTabIds: string[] = [];

  for (const tab of candidates.tabs) {
    try {
      const existing = await chrome.bookmarks.search({ url: tab.url });
      if (existing.some((bookmark) => bookmark.url === tab.url)) {
        skippedCount += 1;
        continue;
      }
      await chrome.bookmarks.create({ title: tab.title || tab.url, url: tab.url });
      createdCount += 1;
    } catch {
      failedTabIds.push(tab.id);
    }
  }

  return { createdCount, skippedCount, failedTabIds };
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
