// 상시 방문 이벤트 수집기 — webNavigation/tabs/windows/idle 리스너를 모두
// initCollector() 안에서 동기적으로 등록한다(MV3 SW는 최초 tick에 등록된 리스너만
// 재시작 후에도 이벤트를 받을 수 있다).
// 수집 실패가 브라우징을 막아서는 안 되므로(fail-open), 모든 큐 호출은 try/catch로 감싼다.
// 계약 근거: docs/target-architecture.md §1, §3, docs/implementation-roadmap.md M2-7~9

import { getSettings } from '../settings';
import { isSensitiveUrl } from '../sensitive-domains';
import type { PageContent } from '../types';
import {
  addDwell,
  addEvent,
  attachContent,
  finalizeOpenEvent,
  getEvent,
  listByStatus,
  replaceEventUrl,
  updateEventTitle,
} from './queue';
import { domainFromUrl, type NewEventInput } from './types';

interface TabState {
  openEventId: string | null;
  lastUrl: string | null;
}

interface ActiveSegment {
  tabId: number;
  windowId: number;
  eventId: string;
  /** epoch ms */
  activeSince: number;
}

const TAB_STATE_KEY = 'orbit:tabState';
const ACTIVE_SEGMENT_KEY = 'orbit:activeSegment';

const SEGMENT_CAP_MS = 30 * 60 * 1000;
const SPA_DEBOUNCE_MS = 500;
const REDIRECT_REPLACE_WINDOW_MS = 3000;
const CONTENT_PULL_DELAY_MS = 1500;

// 탭 상태·활성 세그먼트는 단일 storage.session 키의 read-modify-write라서,
// 핸들러가 동시에 실행되면(예: 세션 복원으로 탭 여러 개 동시 오픈) 나중 쓰기가
// 앞선 쓰기를 덮어써 open 이벤트가 영영 finalize되지 않을 수 있다.
// 같은 SW 인스턴스 안의 모든 상태 변경 핸들러를 하나의 체인으로 직렬화한다.
let mutationChain: Promise<void> = Promise.resolve();

function enqueueMutation(label: string, task: () => Promise<void>): void {
  mutationChain = mutationChain
    .then(task)
    .catch((err) => console.error(`[Orbit] ${label} 처리 실패`, err));
}

// ── 탭 상태 / 활성 세그먼트 — chrome.storage.session (SW 종료 생존, 브라우저 재시작 시 소멸) ──

async function getTabStates(): Promise<Record<number, TabState>> {
  const stored = await chrome.storage.session.get(TAB_STATE_KEY);
  return (stored[TAB_STATE_KEY] as Record<number, TabState> | undefined) ?? {};
}

async function setTabState(tabId: number, state: TabState | null): Promise<void> {
  const states = await getTabStates();
  if (state === null) delete states[tabId];
  else states[tabId] = state;
  await chrome.storage.session.set({ [TAB_STATE_KEY]: states });
}

async function getActiveSegment(): Promise<ActiveSegment | null> {
  const stored = await chrome.storage.session.get(ACTIVE_SEGMENT_KEY);
  return (stored[ACTIVE_SEGMENT_KEY] as ActiveSegment | undefined) ?? null;
}

async function setActiveSegment(segment: ActiveSegment | null): Promise<void> {
  await chrome.storage.session.set({ [ACTIVE_SEGMENT_KEY]: segment });
}

async function closeActiveSegment(): Promise<void> {
  const segment = await getActiveSegment();
  if (!segment) return;
  await setActiveSegment(null);
  const elapsed = Math.min(Date.now() - segment.activeSince, SEGMENT_CAP_MS);
  if (elapsed <= 0) return;
  try {
    await addDwell(segment.eventId, elapsed);
  } catch (err) {
    console.error('[Orbit] addDwell 실패', err);
  }
}

async function openActiveSegment(tabId: number, windowId: number, eventId: string): Promise<void> {
  await closeActiveSegment();
  await setActiveSegment({ tabId, windowId, eventId, activeSince: Date.now() });
}

async function isActiveTab(tabId: number, windowId: number): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return !!tab.active && tab.windowId === windowId;
  } catch {
    return false;
  }
}

// ── 필터 ──────────────────────────────────────────────────────────

/** http/https 외 스킴(chrome://, about:, chrome-extension:// 등)과 about:blank를 거른다. */
function isTrackableUrl(url: string | undefined): url is string {
  if (!url) return false;
  return /^https?:\/\//i.test(url);
}

// ── onCommitted (방문) ───────────────────────────────────────────

async function tryReplaceRecentOpenEvent(
  openEventId: string,
  newUrl: string,
): Promise<boolean> {
  const event = await getEvent(openEventId);
  if (!event || event.status !== 'open') return false;
  const age = Date.now() - new Date(event.visitedAt).getTime();
  if (age >= REDIRECT_REPLACE_WINDOW_MS) return false;
  return replaceEventUrl(openEventId, newUrl, domainFromUrl(newUrl));
}

async function handleCommitted(
  details: chrome.webNavigation.WebNavigationTransitionCallbackDetails,
): Promise<void> {
  if (details.frameId !== 0) return;
  if (!isTrackableUrl(details.url)) return;

  const settings = await getSettings();
  if (!settings.collectionEnabled) return;

  const tabId = details.tabId;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const windowId = tab?.windowId ?? chrome.windows.WINDOW_ID_NONE;

  const states = await getTabStates();
  const prevState = states[tabId];
  const isRedirect =
    details.transitionQualifiers.includes('server_redirect') ||
    details.transitionQualifiers.includes('client_redirect');

  if (isRedirect && prevState?.openEventId) {
    const replaced = await tryReplaceRecentOpenEvent(prevState.openEventId, details.url).catch(
      () => false,
    );
    if (replaced) {
      await setTabState(tabId, { openEventId: prevState.openEventId, lastUrl: details.url });
      return;
    }
  }

  if (prevState?.openEventId) {
    try {
      await finalizeOpenEvent(prevState.openEventId, new Date().toISOString());
    } catch (err) {
      console.error('[Orbit] 직전 이벤트 finalize 실패', err);
    }
  }

  const eventId = crypto.randomUUID();
  const now = new Date().toISOString();
  const input: NewEventInput = {
    eventId,
    eventType: 'visit',
    url: details.url,
    title: tab?.title ?? '',
    domain: domainFromUrl(details.url),
    visitedAt: now,
    endedAt: null,
    tabId,
    windowId,
    referrerUrl: prevState?.lastUrl ?? null,
    previousEventId: prevState?.openEventId ?? null,
    activeDurationMs: 0,
    contentExcerpt: null,
  };

  try {
    await addEvent(input);
  } catch (err) {
    console.error('[Orbit] addEvent 실패', err);
    return;
  }

  await setTabState(tabId, { openEventId: eventId, lastUrl: details.url });

  if (await isActiveTab(tabId, windowId)) {
    await openActiveSegment(tabId, windowId, eventId);
  }
}

// ── onHistoryStateUpdated (SPA 내비게이션) ─────────────────────────

const spaDebounceTimers = new Map<number, ReturnType<typeof setTimeout>>();

async function requestSpaContent(tabId: number, eventId: string): Promise<void> {
  const settings = await getSettings();
  if (!settings.contentCapture) return;

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url) return;
  if (settings.excludeSensitive && isSensitiveUrl(tab.url)) return;

  let content: PageContent | null = null;
  try {
    content = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_CONTENT' });
  } catch {
    return; // content script 미주입 등 — 실패 무시
  }
  if (!content?.textContent) return;

  try {
    await attachContent(eventId, content.textContent);
  } catch (err) {
    console.error('[Orbit] attachContent(spa_nav) 실패', err);
  }
}

async function commitSpaNavigation(tabId: number, url: string): Promise<void> {
  const states = await getTabStates();
  const prevState = states[tabId];
  if (prevState?.lastUrl === url) return; // 같은 URL 중복 제거

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const windowId = tab?.windowId ?? chrome.windows.WINDOW_ID_NONE;

  if (prevState?.openEventId) {
    try {
      await finalizeOpenEvent(prevState.openEventId, new Date().toISOString());
    } catch (err) {
      console.error('[Orbit] 직전 이벤트 finalize 실패', err);
    }
  }

  const eventId = crypto.randomUUID();
  const now = new Date().toISOString();
  const input: NewEventInput = {
    eventId,
    eventType: 'spa_nav',
    url,
    title: tab?.title ?? '',
    domain: domainFromUrl(url),
    visitedAt: now,
    endedAt: null,
    tabId,
    windowId,
    referrerUrl: prevState?.lastUrl ?? null,
    previousEventId: prevState?.openEventId ?? null,
    activeDurationMs: 0,
    contentExcerpt: null,
  };

  try {
    await addEvent(input);
  } catch (err) {
    console.error('[Orbit] addEvent(spa_nav) 실패', err);
    return;
  }

  await setTabState(tabId, { openEventId: eventId, lastUrl: url });

  if (await isActiveTab(tabId, windowId)) {
    await openActiveSegment(tabId, windowId, eventId);
  }

  setTimeout(() => {
    requestSpaContent(tabId, eventId).catch(() => {});
  }, CONTENT_PULL_DELAY_MS);
}

async function handleHistoryStateUpdated(
  details: chrome.webNavigation.WebNavigationTransitionCallbackDetails,
): Promise<void> {
  if (details.frameId !== 0) return;
  if (!isTrackableUrl(details.url)) return;

  const settings = await getSettings();
  if (!settings.collectionEnabled) return;

  const tabId = details.tabId;
  const url = details.url;
  const existingTimer = spaDebounceTimers.get(tabId);
  if (existingTimer) clearTimeout(existingTimer);

  const timer = setTimeout(() => {
    spaDebounceTimers.delete(tabId);
    enqueueMutation('SPA 내비게이션', () => commitSpaNavigation(tabId, url));
  }, SPA_DEBOUNCE_MS);
  spaDebounceTimers.set(tabId, timer);
}

// ── tabs.onUpdated (title 보강) ─────────────────────────────────────

async function handleTabUpdated(
  tabId: number,
  changeInfo: chrome.tabs.OnUpdatedInfo,
): Promise<void> {
  if (changeInfo.title === undefined) return;

  const settings = await getSettings();
  if (!settings.collectionEnabled) return;

  const states = await getTabStates();
  const openEventId = states[tabId]?.openEventId;
  if (!openEventId) return;

  try {
    await updateEventTitle(openEventId, changeInfo.title);
  } catch (err) {
    console.error('[Orbit] title 보강 실패', err);
  }
}

// ── 체류시간 세그먼트 갱신 트리거 ────────────────────────────────────

async function handleTabActivated(activeInfo: chrome.tabs.OnActivatedInfo): Promise<void> {
  const settings = await getSettings();
  if (!settings.collectionEnabled) {
    await closeActiveSegment();
    return;
  }

  const states = await getTabStates();
  const openEventId = states[activeInfo.tabId]?.openEventId;
  if (!openEventId) {
    await closeActiveSegment();
    return;
  }

  const tab = await chrome.tabs.get(activeInfo.tabId).catch(() => null);
  const windowId = tab?.windowId ?? activeInfo.windowId;
  await openActiveSegment(activeInfo.tabId, windowId, openEventId);
}

async function handleWindowFocusChanged(windowId: number): Promise<void> {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await closeActiveSegment();
    return;
  }

  const settings = await getSettings();
  if (!settings.collectionEnabled) {
    await closeActiveSegment();
    return;
  }

  const [activeTab] = await chrome.tabs.query({ active: true, windowId });
  if (!activeTab?.id) {
    await closeActiveSegment();
    return;
  }

  const states = await getTabStates();
  const openEventId = states[activeTab.id]?.openEventId;
  if (!openEventId) {
    await closeActiveSegment();
    return;
  }

  await openActiveSegment(activeTab.id, windowId, openEventId);
}

async function handleIdleStateChanged(state: `${chrome.idle.IdleState}`): Promise<void> {
  if (state === 'idle' || state === 'locked') {
    await closeActiveSegment();
    return;
  }

  // state === 'active' — 현재 포커스된 창의 활성 탭 기준으로 세그먼트를 재개한다.
  const settings = await getSettings();
  if (!settings.collectionEnabled) return;

  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!activeTab?.id || activeTab.windowId === undefined) return;

  const states = await getTabStates();
  const openEventId = states[activeTab.id]?.openEventId;
  if (!openEventId) return;

  await openActiveSegment(activeTab.id, activeTab.windowId, openEventId);
}

async function handleTabRemoved(tabId: number): Promise<void> {
  const segment = await getActiveSegment();
  if (segment?.tabId === tabId) {
    await closeActiveSegment();
  }

  const states = await getTabStates();
  const openEventId = states[tabId]?.openEventId;
  if (openEventId) {
    try {
      await finalizeOpenEvent(openEventId, new Date().toISOString());
    } catch (err) {
      console.error('[Orbit] onRemoved finalize 실패', err);
    }
  }
  await setTabState(tabId, null);
}

// ── 본문 부착 (background의 PAGE_CONTENT_READY 수신 경로에서 호출) ──────

export async function handlePageContentReady(
  tabId: number,
  content: PageContent | null,
): Promise<void> {
  if (!content?.textContent) return;

  const settings = await getSettings();
  if (!settings.contentCapture) return;

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab?.url && settings.excludeSensitive && isSensitiveUrl(tab.url)) return;

  const states = await getTabStates();
  const openEventId = states[tabId]?.openEventId;
  if (!openEventId) return;

  try {
    await attachContent(openEventId, content.textContent);
  } catch (err) {
    console.error('[Orbit] attachContent(PAGE_CONTENT_READY) 실패', err);
  }
}

// ── 등록 ────────────────────────────────────────────────────────────

/**
 * 이전 SW 수명에서 finalize를 놓친 고아 open 이벤트 정리 —
 * 탭이 이미 사라진 open 이벤트를 pending으로 전환해 동기화 대상에 포함시킨다.
 * (SW가 onRemoved 처리 중 죽는 등의 레이스로 open에 갇힌 이벤트의 회수 경로)
 */
export async function finalizeOrphanOpenEvents(): Promise<void> {
  const [tabs, openEvents] = await Promise.all([chrome.tabs.query({}), listByStatus('open')]);
  if (openEvents.length === 0) return;

  const aliveTabIds = new Set(tabs.map((t) => t.id).filter((id): id is number => id != null));
  const now = new Date().toISOString();
  for (const event of openEvents) {
    if (aliveTabIds.has(event.tabId)) continue;
    await finalizeOpenEvent(event.eventId, now);
    await setTabState(event.tabId, null);
  }
}

export function initCollector(): void {
  chrome.webNavigation.onCommitted.addListener((details) => {
    enqueueMutation('onCommitted', () => handleCommitted(details));
  });

  chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
    handleHistoryStateUpdated(details).catch((err) =>
      console.error('[Orbit] onHistoryStateUpdated 처리 실패', err),
    );
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    enqueueMutation('onUpdated(title)', () => handleTabUpdated(tabId, changeInfo));
  });

  chrome.tabs.onActivated.addListener((activeInfo) => {
    enqueueMutation('onActivated', () => handleTabActivated(activeInfo));
  });

  chrome.windows.onFocusChanged.addListener((windowId) => {
    enqueueMutation('onFocusChanged', () => handleWindowFocusChanged(windowId));
  });

  chrome.idle.setDetectionInterval(60);
  chrome.idle.onStateChanged.addListener((state) => {
    enqueueMutation('idle.onStateChanged(dwell)', () => handleIdleStateChanged(state));
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    enqueueMutation('onRemoved', () => handleTabRemoved(tabId));
  });
}
