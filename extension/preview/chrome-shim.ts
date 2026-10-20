/**
 * 확장 밖(일반 웹 페이지)에서 새 탭·사이드패널을 띄우기 위한 `chrome.*` 대역.
 *
 * - storage: localStorage 에 두고 BroadcastChannel 로 다른 iframe 에도 onChanged 를 보낸다.
 *   실제 크롬처럼 쓴 쪽에도 onChanged 가 온다.
 * - runtime.sendMessage: 다른 iframe 의 onMessage 로 간다(세션 변경 알림이 이 길을 쓴다).
 * - 탭 열기·창 만들기: 실제로 열지 않고 미리보기 안내로 바꾼다(링크 하나에 탭 수십 개가 열리지 않게).
 * - 그 밖의 API: 없는 이름은 아무것도 하지 않는 함수와 이벤트로 답한다.
 */
import { OPEN_TABS, TOP_SITES } from './fixtures';

type Listener = (...args: unknown[]) => unknown;

function event() {
  const listeners = new Set<Listener>();
  return {
    addListener: (listener: Listener) => void listeners.add(listener),
    removeListener: (listener: Listener) => void listeners.delete(listener),
    hasListener: (listener: Listener) => listeners.has(listener),
    emit: (...args: unknown[]) => listeners.forEach((listener) => listener(...args)),
  };
}

const channel = new BroadcastChannel('orbit-preview');
const storageChanged = event();
const runtimeMessage = event();

type Area = 'local' | 'session' | 'sync';
const PREFIX = 'orbit-preview:storage:';

function readArea(area: Area): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(PREFIX + area) ?? '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeArea(area: Area, values: Record<string, unknown>, changes: Record<string, { oldValue?: unknown; newValue?: unknown }>) {
  localStorage.setItem(PREFIX + area, JSON.stringify(values));
  if (!Object.keys(changes).length) return;
  storageChanged.emit(changes, area);
  channel.postMessage({ kind: 'storage', area, changes });
}

function storageArea(area: Area) {
  return {
    async get(keys?: string | string[] | Record<string, unknown> | null) {
      const all = readArea(area);
      if (keys == null) return all;
      if (typeof keys === 'string') return keys in all ? { [keys]: all[keys] } : {};
      if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k) => k in all).map((k) => [k, all[k]]));
      return Object.fromEntries(Object.entries(keys).map(([k, fallback]) => [k, k in all ? all[k] : fallback]));
    },
    async set(items: Record<string, unknown>) {
      const all = readArea(area);
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      Object.entries(items).forEach(([key, value]) => {
        changes[key] = { oldValue: all[key], newValue: value };
        all[key] = value;
      });
      writeArea(area, all, changes);
    },
    async remove(keys: string | string[]) {
      const all = readArea(area);
      const changes: Record<string, { oldValue?: unknown }> = {};
      (Array.isArray(keys) ? keys : [keys]).forEach((key) => {
        if (key in all) changes[key] = { oldValue: all[key] };
        delete all[key];
      });
      writeArea(area, all, changes);
    },
    async clear() {
      const all = readArea(area);
      writeArea(area, {}, Object.fromEntries(Object.keys(all).map((key) => [key, { oldValue: all[key] }])));
    },
    onChanged: event(),
  };
}

channel.addEventListener('message', (message: MessageEvent) => {
  const data = message.data as { kind: string; area?: Area; changes?: unknown; payload?: unknown };
  if (data.kind === 'storage') storageChanged.emit(data.changes, data.area);
  if (data.kind === 'message') runtimeMessage.emit(data.payload, { id: 'preview' }, () => {});
});

/** 탭을 여는 동작은 미리보기 안내로 바꾼다. */
function notifyOpen(what: string, urls: string[]) {
  console.info(`[preview] ${what}`, urls);
  window.parent.postMessage({ kind: 'orbit-preview:open', what, urls }, '*');
}

let nextTabId = 1000;
const tabs = OPEN_TABS.map((t, index) => ({
  id: index + 1, windowId: 1, index, active: index === 0, highlighted: index === 0, pinned: false, incognito: false,
  title: t.title, url: t.url, favIconUrl: '', status: 'complete', discarded: false, autoDiscardable: true, groupId: -1,
  selected: index === 0,
}));

const known = {
  storage: {
    local: storageArea('local'),
    session: storageArea('session'),
    sync: storageArea('sync'),
    onChanged: storageChanged,
  },
  runtime: {
    id: 'orbit-preview',
    lastError: undefined,
    getURL: (path: string) => new URL(path.replace(/^\/?/, '/'), location.origin).toString(),
    sendMessage: async (payload: unknown) => {
      channel.postMessage({ kind: 'message', payload });
      return undefined;
    },
    onMessage: runtimeMessage,
    getManifest: () => ({ version: 'preview', manifest_version: 3, name: 'Orbit (preview)' }),
  },
  identity: {
    getAuthToken: (_details: unknown, callback?: (result: { token: string }) => void) => {
      callback?.({ token: 'preview-google-token' });
      return Promise.resolve({ token: 'preview-google-token' });
    },
    removeCachedAuthToken: async () => undefined,
  },
  tabs: {
    query: async () => tabs,
    get: async (id: number) => tabs.find((t) => t.id === id) ?? tabs[0],
    create: async (props: { url?: string }) => {
      notifyOpen('새 탭 열기', props.url ? [props.url] : []);
      return { ...tabs[0], id: nextTabId++, url: props.url ?? '' };
    },
    update: async (id: number) => tabs.find((t) => t.id === id) ?? tabs[0],
    remove: async () => undefined,
    sendMessage: async () => undefined,
    onUpdated: event(), onRemoved: event(), onActivated: event(), onCreated: event(),
  },
  windows: {
    WINDOW_ID_NONE: -1,
    WINDOW_ID_CURRENT: -2,
    getCurrent: async () => ({ id: 1, focused: true }),
    create: async (props: { url?: string | string[] }) => {
      const urls = Array.isArray(props.url) ? props.url : props.url ? [props.url] : [];
      notifyOpen(`새 창에 탭 ${urls.length}개 열기`, urls);
      return { id: 2, focused: true };
    },
    update: async () => ({ id: 1, focused: true }),
    onFocusChanged: event(),
  },
  topSites: { get: async () => TOP_SITES },
  search: {
    query: async ({ text }: { text: string }) => notifyOpen(`웹 검색: ${text}`, []),
  },
  bookmarks: { search: async () => [], create: async () => ({ id: 'b1' }) },
  sidePanel: { open: async () => undefined, setOptions: async () => undefined },
  alarms: { create: async () => undefined, clear: async () => true, get: async () => undefined, onAlarm: event() },
  idle: { onStateChanged: event(), queryState: async () => 'active' },
};

/** 모르는 이름은 아무것도 하지 않는다 — 미리보기가 화면과 무관한 API 때문에 멈추지 않게. */
function lenient(target: Record<string, unknown>): unknown {
  return new Proxy(target, {
    get(object, key: string | symbol) {
      if (typeof key === 'symbol') return Reflect.get(object, key);
      if (key in object) {
        const value = object[key];
        return value && typeof value === 'object' && !Array.isArray(value) ? lenient(value as Record<string, unknown>) : value;
      }
      if (key.startsWith('on')) return event();
      return lenient(Object.assign(async () => undefined, {}) as unknown as Record<string, unknown>);
    },
  });
}

export function installChromeShim(): void {
  (globalThis as unknown as { chrome: unknown }).chrome = lenient(known as unknown as Record<string, unknown>);
}
