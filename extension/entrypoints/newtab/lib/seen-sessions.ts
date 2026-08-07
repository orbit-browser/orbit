/**
 * "새로 저장됨" 표시를 이미 확인한 세션 목록.
 *
 * 갓 만들어진 세션은 네비게이터에 맥동하는 점으로 표시된다.
 * 사용자가 한 번 열어보면 그 표시는 사라지고 평소처럼 파비콘이 보여야 한다 —
 * 계속 깜빡이면 무엇이 진짜 새 것인지 구분이 안 된다.
 *
 * 저장은 `chrome.storage.local`. 확인 여부는 이 기기에서의 읽음 상태라
 * 서버에 둘 성격이 아니다.
 */

const STORAGE_KEY = 'newtab.seenSessions';

/** 무한정 쌓이지 않게 최근 것만 남긴다. */
const MAX_TRACKED = 300;

export async function loadSeenSessions(): Promise<Set<string>> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const saved = stored[STORAGE_KEY];
    return new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : []);
  } catch (err) {
    console.error('[Orbit] 확인한 세션 목록 조회 실패', err);
    return new Set();
  }
}

/** 이미 있는 id면 아무것도 하지 않고 기존 집합을 그대로 돌려준다. */
export async function markSessionSeen(seen: Set<string>, sessionId: string): Promise<Set<string>> {
  if (seen.has(sessionId)) return seen;

  const next = new Set(seen);
  next.add(sessionId);

  const trimmed = [...next].slice(-MAX_TRACKED);
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: trimmed });
  } catch (err) {
    // 저장 실패해도 이번 탭에서는 표시가 사라지도록 메모리 상태는 갱신한다.
    console.error('[Orbit] 확인한 세션 저장 실패', err);
  }
  return new Set(trimmed);
}
