// 사이드패널과 SW(백그라운드)가 공유하는 설정 저장소.
// localStorage는 SW에서 접근할 수 없어 chrome.storage.local을 진실 원천으로 둔다.
// zustand persist 봉투({state, version}) 없이 평문 OrbitSettings JSON으로 저장한다.

import { getSession } from './auth';

/** 화면 모양. system 은 OS 설정을 따라간다. */
export type OrbitTheme = 'system' | 'light' | 'dark';

export interface OrbitSettings {
  theme: OrbitTheme;
  /**
   * 지금 로그인한 계정의 수집 동의를 비춘 값(화면·수집기가 읽는다). 동의 자체는 계정별로
   * `orbit:collectionConsent`에 있고, 계정이 바뀌면 SW가 새 계정의 동의로 바꿔 놓는다.
   */
  collectionEnabled: boolean;
  contentCapture: boolean;
  excludeSensitive: boolean;
  autoSyncEnabled: boolean;
  autoSyncIntervalMin: 15 | 30 | 60;
  idleSyncMin: number;
  countThreshold: number;
  rerankEnabled: boolean;
  /**
   * 지금 보고 있는 팀 워크스페이스. null 이면 개인 기록이다.
   * 사이드패널·새 탭 아틀라스·Ask 가 같은 범위를 보도록 여기 둔다.
   */
  activeWorkspaceId: string | null;
  /** 개인 워크스페이스 이름. 비우면 "내 Orbit" 으로 보인다(서버에 두지 않는 내 화면 이름). */
  personalWorkspaceName: string | null;
}

export const DEFAULT_SETTINGS: OrbitSettings = {
  theme: 'system',
  collectionEnabled: false,
  contentCapture: true,
  excludeSensitive: true,
  autoSyncEnabled: false,
  autoSyncIntervalMin: 30,
  idleSyncMin: 10,
  countThreshold: 20,
  rerankEnabled: false,
  activeWorkspaceId: null,
  personalWorkspaceName: null,
};

const STORAGE_KEY = 'orbit:settings';
const CONSENT_KEY = 'orbit:collectionConsent';

/**
 * 수집 동의 화면과 설정에 함께 쓰는 외부 AI 전송 범위 안내. 실제로 보내는 것보다 적게 읽히면 안 된다.
 * 근거(backend): 제목·검색어·본문 발췌는 요약·세션화·임베딩·Ask로 간다. 주소는 `ai_safe_url/path`가
 * 쿼리와 비밀 같은 조각을 지운 형태다. 민감 URL은 받을 때 본문을 지우고 주소는 도메인만 남지만 제목은 간다.
 * 제공자는 config.py 기준(임베딩 Upstage, LLM A.X-K1·대체 EXAONE). 바뀌면 이 문구도 바꾼다.
 */
export const AI_DISCLOSURE =
  '세션 정리와 검색을 위해 페이지 제목·주소·검색어·본문 일부가 AI 서비스(Upstage·SKT A.X·LG EXAONE)로 전송돼요. 민감한 사이트는 제목과 도메인만 보내요.';
/** 같은 뜻, "~합니다" 말투의 새 탭 설정 화면용. */
export const AI_DISCLOSURE_FORMAL =
  '세션 정리와 검색을 위해 페이지 제목·주소·검색어·본문 일부가 AI 서비스(Upstage·SKT A.X·LG EXAONE)로 전송됩니다. 민감한 사이트는 제목과 도메인만 보냅니다.';

/** 계정 id → 수집 동의. 동의한 사람과 수집되는 사람이 같아야 하므로 브라우저가 아니라 계정에 묶는다. */
export type CollectionConsent = Record<string, boolean>;

/**
 * 계정별 수집 동의를 읽는다. 키가 아직 없으면(이 업데이트 직후 한 번) 브라우저 단위였던 기존
 * 동의를 `owner`(기본: 지금 로그인한 계정)의 동의로 옮긴다 — 그 계정이 켰던 스위치이므로
 * 다시 묻지 않는다. 로그인한 계정이 없으면 옮길 주인이 없어 빈 동의로 시작한다.
 */
export async function getCollectionConsent(owner?: string): Promise<CollectionConsent> {
  const stored = await chrome.storage.local.get([CONSENT_KEY, STORAGE_KEY]);
  const saved = stored[CONSENT_KEY] as CollectionConsent | undefined;
  if (saved) return saved;
  const ownerId = owner ?? (await getSession())?.user.id;
  const legacy = { ...DEFAULT_SETTINGS, ...(stored[STORAGE_KEY] as Partial<OrbitSettings> | undefined) };
  const migrated: CollectionConsent = ownerId ? { [ownerId]: legacy.collectionEnabled } : {};
  await chrome.storage.local.set({ [CONSENT_KEY]: migrated });
  return migrated;
}

export async function hasCollectionConsent(accountId: string): Promise<boolean> {
  return (await getCollectionConsent())[accountId] === true;
}
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
    const writes: Record<string, unknown> = { [STORAGE_KEY]: merged };
    if (partial.collectionEnabled !== undefined) {
      // 수집 스위치는 지금 계정의 동의다. 로그아웃 상태의 변경(계정 전환 정리)은 누구의 동의도 아니다.
      const accountId = (await getSession())?.user.id;
      if (accountId) {
        const consent = await getCollectionConsent(accountId);
        writes[CONSENT_KEY] = { ...consent, [accountId]: partial.collectionEnabled };
      }
    }
    await chrome.storage.local.set(writes);
    return merged;
  });
  writeQueue = next.catch(() => {});
  return next;
}

/** chrome.storage.onChanged을 래핑 — 다른 컨텍스트(SW ↔ 사이드패널)의 설정 변경을 구독한다. */
export function subscribeSettings(
  cb: (settings: OrbitSettings, previous: OrbitSettings) => void,
): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ) => {
    if (areaName !== 'local' || !(STORAGE_KEY in changes)) return;
    const saved = changes[STORAGE_KEY].newValue as Partial<OrbitSettings> | undefined;
    const previous = changes[STORAGE_KEY].oldValue as Partial<OrbitSettings> | undefined;
    cb({ ...DEFAULT_SETTINGS, ...saved }, { ...DEFAULT_SETTINGS, ...previous });
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
