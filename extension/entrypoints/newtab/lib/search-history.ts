/**
 * 새 탭 히어로 검색창의 최근 검색 기록.
 *
 * 크롬 주소창이나 구글 계정의 검색 기록은 확장이 읽을 수 없고(`history` 권한을 붙여도
 * 방문 기록에서 역추적하는 우회다), 그 권한을 요구할 만큼의 기능이 아니라고 판단했다.
 * 그래서 **Orbit 검색창에서 실제로 실행한 검색어만** 이 기기의 로컬 저장소에 남긴다.
 * 동기화하지 않으며 사용자가 항목별로 지울 수 있다.
 *
 * 바로가기(`shortcuts.ts`)와 같은 형태로 순수 로직과 저장소 접근을 나눠 둔다.
 */

export interface SearchHistoryEntry {
  query: string;
  /** 마지막으로 검색한 시각(ms). 목록 정렬 기준이다. */
  at: number;
}

/** 드롭다운 한 화면에 담기는 만큼만 남긴다. */
export const MAX_SEARCH_HISTORY = 10;

const STORAGE_KEY = 'newtab.searchHistory';

/** 같은 검색어로 보는 기준. 앞뒤 공백과 대소문자만 무시한다. */
function historyKey(query: string): string {
  return query.trim().toLowerCase();
}

/**
 * 검색어를 목록 맨 앞에 올린다.
 * 이미 있던 검색어면 새로 쌓지 않고 시각만 갱신해 위로 올린다(크롬·구글과 같은 규칙).
 * 빈 입력은 기록하지 않는다.
 */
export function appendSearchQuery(
  list: SearchHistoryEntry[],
  query: string,
  at: number,
): SearchHistoryEntry[] {
  const trimmed = query.trim();
  if (!trimmed) return list;

  const key = historyKey(trimmed);
  const rest = list.filter((entry) => historyKey(entry.query) !== key);
  return [{ query: trimmed, at }, ...rest].slice(0, MAX_SEARCH_HISTORY);
}

export function removeSearchQuery(
  list: SearchHistoryEntry[],
  query: string,
): SearchHistoryEntry[] {
  const key = historyKey(query);
  return list.filter((entry) => historyKey(entry.query) !== key);
}

/**
 * 입력 중인 값으로 목록을 좁힌다. 입력이 비었으면 최근순 전체.
 * 지금 입력한 것과 완전히 같은 검색어는 고를 이유가 없으므로 뺀다.
 */
export function filterSearchHistory(
  list: SearchHistoryEntry[],
  input: string,
): SearchHistoryEntry[] {
  const needle = historyKey(input);
  if (!needle) return list;
  return list.filter((entry) => {
    const key = historyKey(entry.query);
    return key !== needle && key.includes(needle);
  });
}

/** 저장된 값이 우리 형식인지 확인한다. 손상된 값은 통째로 버린다. */
function parseStored(value: unknown): SearchHistoryEntry[] | null {
  if (!Array.isArray(value)) return null;
  const entries: SearchHistoryEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const { query, at } = item as Partial<SearchHistoryEntry>;
    if (typeof query !== 'string' || !query.trim()) continue;
    entries.push({ query, at: typeof at === 'number' ? at : 0 });
  }
  return entries.slice(0, MAX_SEARCH_HISTORY);
}

// ── 저장소 ────────────────────────────────────────────────────────────────

/**
 * 읽기에 실패해도 빈 목록을 돌려준다.
 * 최근 기록은 보조 기능이라, 없다고 검색창 자체가 막히면 안 된다.
 */
export async function loadSearchHistory(): Promise<SearchHistoryEntry[]> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    return parseStored(stored[STORAGE_KEY]) ?? [];
  } catch (err) {
    console.error('[Orbit] 최근 검색 기록 불러오기 실패', err);
    return [];
  }
}

export async function saveSearchHistory(list: SearchHistoryEntry[]): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: list });
  } catch (err) {
    // 검색은 이미 실행된 뒤다. 기록만 못 남기므로 사용자를 막지 않고 로그만 남긴다.
    console.error('[Orbit] 최근 검색 기록 저장 실패', err);
  }
}

/** 검색 실행 시점에 부른다. 저장 후 갱신된 목록을 돌려준다. */
export async function recordSearchQuery(
  query: string,
  at: number = Date.now(),
): Promise<SearchHistoryEntry[]> {
  const next = appendSearchQuery(await loadSearchHistory(), query, at);
  await saveSearchHistory(next);
  return next;
}
