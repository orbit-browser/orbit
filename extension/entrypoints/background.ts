import { handlePageContentReady, initCollector } from '../lib/events/collector';
import { initTriggers } from '../lib/sync/triggers';
import { captureActiveTab, forgetTabThumbnail } from '../lib/tab-thumbnails';
import type { PageContent } from '../lib/types';

// 탭 ID → 추출된 페이지 콘텐츠 캐시 (서비스 워커 생존 동안 유지)
const pageContentCache = new Map<number, PageContent | null>();

export default defineBackground(() => {
  // 컴포지션 루트 — 상시 수집기와 동기화 엔진의 리스너를 SW 최초 tick에 동기적으로 등록한다.
  initCollector();
  initTriggers();

  chrome.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error('[Orbit] sidePanel 설정 실패', err));

  // 탭 변경 → 사이드패널에 알림 (50ms 디바운스로 연속 이벤트 묶음)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  function notifyTabsChanged() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'TABS_CHANGED' }).catch(() => {});
    }, 50);
  }

  chrome.tabs.onCreated.addListener(notifyTabsChanged);
  chrome.tabs.onRemoved.addListener(notifyTabsChanged);
  chrome.tabs.onActivated.addListener(notifyTabsChanged);
  chrome.windows.onFocusChanged.addListener(notifyTabsChanged);
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    // loading: 탭 내비게이션 시작 시점에도 즉시 반영
    if (changeInfo.status === 'loading' || changeInfo.status === 'complete' || changeInfo.title !== undefined) {
      notifyTabsChanged();
    }
  });

  /*
   * 열린 탭 미리보기 썸네일.
   *
   * 사용자가 보고 있는 탭만 조용히 찍는다. 렌더가 끝난 뒤를 노려 지연을 두고,
   * 그 사이 다른 탭으로 옮겨 갔으면 찍지 않는다 — 엉뚱한 화면이 저장되는 걸 막는다.
   */
  let captureTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleCapture() {
    if (captureTimer) clearTimeout(captureTimer);
    captureTimer = setTimeout(async () => {
      captureTimer = null;
      try {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (tab?.id === undefined || tab.windowId === undefined) return;
        await captureActiveTab(tab.id, tab.windowId, tab.url ?? '');
      } catch {
        // 활성 탭을 못 읽는 상황(창 없음 등) — 다음 기회에 찍는다.
      }
    }, 900);
  }

  chrome.tabs.onActivated.addListener(scheduleCapture);
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.active) scheduleCapture();
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    void forgetTabThumbnail(tabId);
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // 탭 목록 조회
    if (message?.type === 'GET_CURRENT_TABS') {
      chrome.tabs.query({ currentWindow: true }).then((tabs) => sendResponse({ tabs }));
      return true;
    }

    // content script → 페이지 추출 완료, 캐시 갱신 + 큐 부착
    if (message?.type === 'PAGE_CONTENT_READY' && sender.tab?.id != null) {
      const tabId = sender.tab.id;
      pageContentCache.set(tabId, message.content ?? null);
      handlePageContentReady(tabId, message.content ?? null).catch((err) =>
        console.error('[Orbit] handlePageContentReady 실패', err),
      );
      return false;
    }

    // side panel → 특정 탭 콘텐츠 조회 (캐시 우선, 없으면 온-디맨드)
    if (message?.type === 'GET_PAGE_CONTENT') {
      const tabId: number = message.tabId;
      if (pageContentCache.has(tabId)) {
        sendResponse(pageContentCache.get(tabId) ?? null);
        return false;
      }
      chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_CONTENT' })
        .then((content) => {
          pageContentCache.set(tabId, content ?? null);
          sendResponse(content ?? null);
        })
        .catch(() => sendResponse(null));
      return true;
    }

    return false;
  });
});
