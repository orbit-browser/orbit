import type { Session } from './types';

const STORAGE_KEY = 'orbit_sessions';

function hasStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local;
}

export async function loadSessions(): Promise<Session[]> {
  if (!hasStorage()) return [];
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as Session[] | undefined) ?? [];
}

export async function upsertSession(session: Session): Promise<void> {
  const sessions = await loadSessions();
  const idx = sessions.findIndex((s) => s.id === session.id);
  if (idx >= 0) {
    sessions[idx] = session;
  } else {
    sessions.unshift(session);
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: sessions });
}

export async function updateSessionTitle(id: string, title: string): Promise<void> {
  const sessions = await loadSessions();
  const session = sessions.find((s) => s.id === id);
  if (!session) return;
  session.title = title;
  session.updatedAt = new Date().toISOString();
  await chrome.storage.local.set({ [STORAGE_KEY]: sessions });
}

export async function deleteSession(id: string): Promise<void> {
  const sessions = await loadSessions();
  await chrome.storage.local.set({
    [STORAGE_KEY]: sessions.filter((s) => s.id !== id),
  });
}
