import type { Session } from './types';
import { mockSessions } from './mock/mockSessions';

// ─────────────────────────────────────────────────────────────
// 현재는 mock Promise 를 반환합니다.
// 후속 단계에서 각 함수 내부를 `fetch(`${API_BASE}/...`)` 로 교체하면
// 상위 훅(useSessions/useSearch)은 수정 없이 그대로 동작합니다.
// ─────────────────────────────────────────────────────────────

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchSessions(): Promise<Session[]> {
  await delay(150);
  return mockSessions;
}

export async function fetchSession(id: string): Promise<Session | undefined> {
  await delay(120);
  return mockSessions.find((s) => s.id === id);
}

export async function searchSessions(query: string): Promise<Session[]> {
  await delay(200);
  const q = query.trim().toLowerCase();
  if (!q) return mockSessions;
  // 후속: POST /search (Solar Embedding + Qdrant RAG) 로 교체
  return mockSessions.filter(
    (s) =>
      s.title.toLowerCase().includes(q) ||
      s.summary.overview.toLowerCase().includes(q) ||
      s.tabs.some((t) => t.title.toLowerCase().includes(q)),
  );
}
