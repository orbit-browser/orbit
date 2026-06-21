import type { Session } from './types';
import { loadSessions } from './storage';

export async function fetchSessions(): Promise<Session[]> {
  return loadSessions();
}

export async function fetchSession(id: string): Promise<Session | undefined> {
  const sessions = await loadSessions();
  return sessions.find((s) => s.id === id);
}

export async function searchSessions(query: string): Promise<Session[]> {
  const sessions = await loadSessions();
  const q = query.trim().toLowerCase();
  if (!q) return sessions;
  // 후속: POST /search (Solar Embedding + Qdrant RAG) 로 교체
  return sessions.filter(
    (s) =>
      s.title.toLowerCase().includes(q) ||
      s.summary.overview.toLowerCase().includes(q) ||
      s.tabs.some((t) => t.title.toLowerCase().includes(q)),
  );
}
