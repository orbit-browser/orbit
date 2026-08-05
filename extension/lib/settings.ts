// 사이드패널과 SW(백그라운드)가 공유하는 설정 저장소.
// localStorage는 SW에서 접근할 수 없어 chrome.storage.local을 진실 원천으로 둔다.
// zustand persist 봉투({state, version}) 없이 평문 OrbitSettings JSON으로 저장한다.

export interface OrbitSettings {
  collectionEnabled: boolean;
  contentCapture: boolean;
  excludeSensitive: boolean;
  autoSyncEnabled: boolean;
  autoSyncIntervalMin: 15 | 30 | 60;
  idleSyncMin: number;
  countThreshold: number;
  rerankEnabled: boolean;
}

export const DEFAULT_SETTINGS: OrbitSettings = {
  collectionEnabled: false,
  contentCapture: true,
  excludeSensitive: true,
  autoSyncEnabled: false,
  autoSyncIntervalMin: 30,
  idleSyncMin: 10,
  countThreshold: 20,
  rerankEnabled: false,
};

const STORAGE_KEY = 'orbit:settings';
/** 이관 대상 — 기존 zustand persist(localStorage)가 쓰던 키. */
const LEGACY_LOCALSTORAGE_KEY = 'orbit-settings';

export async function getSettings(): Promise<OrbitSettings> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const saved = stored[STORAGE_KEY] as Partial<OrbitSettings> | undefined;
  return { ...DEFAULT_SETTINGS, ...saved };
}

// 동일 컨텍스트 내 연속 호출(예: 토글 두 개를 빠르게 클릭)이 서로의 쓰기를 덮어쓰지 않도록
// read-modify-write를 큐에 태워 직렬화한다. 다른 컨텍스트(SW ↔ 사이드패널) 간 동시 쓰기까지
// 막지는 못하지만, 각자 자신이 쓴 값만 갱신하는 부분 갱신(partial)이라 실사용 범위에서는 안전하다.
let writeQueue: Promise<unknown> = Promise.resolve();

export function updateSettings(partial: Partial<OrbitSettings>): Promise<OrbitSettings> {
  const next = writeQueue.then(async () => {
    const merged = { ...(await getSettings()), ...partial };
    await chrome.storage.local.set({ [STORAGE_KEY]: merged });
    return merged;
  });
  writeQueue = next.catch(() => {});
  return next;
}

/** chrome.storage.onChanged을 래핑 — 다른 컨텍스트(SW ↔ 사이드패널)의 설정 변경을 구독한다. */
export function subscribeSettings(cb: (settings: OrbitSettings) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ) => {
    if (areaName !== 'local' || !(STORAGE_KEY in changes)) return;
    const saved = changes[STORAGE_KEY].newValue as Partial<OrbitSettings> | undefined;
    cb({ ...DEFAULT_SETTINGS, ...saved });
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/**
 * 1회 마이그레이션 — 기존 localStorage(zustand persist 봉투)의 rerankEnabled/excludeSensitive를
 * chrome.storage.local로 복사한다. chrome.storage에 이미 값이 있으면(이관 완료 또는 신규 사용자)
 * 아무 것도 하지 않는다. localStorage는 사이드패널 컨텍스트에서만 접근 가능하므로
 * 이 함수는 반드시 사이드패널 초기화 경로에서만 호출해야 한다(SW에서 호출 금지).
 */
export async function migrateLegacySettings(): Promise<void> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  if (stored[STORAGE_KEY]) return;

  const raw = window.localStorage.getItem(LEGACY_LOCALSTORAGE_KEY);
  if (!raw) return;

  try {
    const legacy = (JSON.parse(raw) as { state?: Partial<OrbitSettings> }).state;
    if (!legacy) return;

    const migrated: Partial<OrbitSettings> = {};
    if (typeof legacy.rerankEnabled === 'boolean') migrated.rerankEnabled = legacy.rerankEnabled;
    if (typeof legacy.excludeSensitive === 'boolean')
      migrated.excludeSensitive = legacy.excludeSensitive;

    if (Object.keys(migrated).length > 0) await updateSettings(migrated);
  } catch {
    // 손상된 legacy 값은 무시하고 기본값으로 진행
  }
}
