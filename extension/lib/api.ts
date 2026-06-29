import { getTabPageContent } from './chrome-bridge';
import type { Session, SessionSummary, TabItem } from './types';

const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

// ── 백엔드 응답 타입 (snake_case) ─────────────────────

interface BackendSummary {
  overview: string;
  purpose: string;
  highlights: string[];
  todos: string[];
  next_actions: string[];
}

interface BackendTab {
  id: string;
  title: string;
  url: string;
  fav_icon_url: string | null;
}

interface BackendSession {
  session_id: string;
  title: string;
  summary: BackendSummary;
  tabs: BackendTab[];
  created_at: string;
  updated_at: string;
}

// ── 타입 변환 ────────────────────────────────────────

function formatTimeLabel(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function mapSummary(b: BackendSummary): SessionSummary {
  return {
    overview: b.overview,
    purpose: b.purpose || undefined,
    highlights: b.highlights,
    todos: b.todos.length ? b.todos : undefined,
    nextActions: b.next_actions.length ? b.next_actions : undefined,
  };
}

function mapSession(b: BackendSession): Session {
  return {
    id: b.session_id,
    title: b.title,
    tabs: b.tabs.map((t) => ({
      id: t.id,
      title: t.title,
      url: t.url,
      favIconUrl: t.fav_icon_url ?? undefined,
    })),
    createdAt: b.created_at,
    updatedAt: b.updated_at,
    timeLabel: formatTimeLabel(new Date(b.created_at)),
    summary: mapSummary(b.summary),
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`[Orbit API] ${init?.method ?? 'GET'} ${path} ${res.status}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── 공개 API ─────────────────────────────────────────

export async function fetchSessions(): Promise<Session[]> {
  const data = await request<BackendSession[]>('/sessions');
  return data.map(mapSession);
}

export async function fetchSession(id: string): Promise<Session | undefined> {
  try {
    const data = await request<BackendSession>(`/sessions/${id}`);
    return mapSession(data);
  } catch (err) {
    if (err instanceof Error && err.message.includes('404')) return undefined;
    throw err;
  }
}

export async function saveSession(tabs: TabItem[]): Promise<Session> {
  // 각 탭의 페이지 콘텐츠를 병렬로 수집
  const enriched = await Promise.all(
    tabs.map(async (tab) => {
      const content = await getTabPageContent(parseInt(tab.id, 10));
      return {
        url: tab.url,
        title: tab.title,
        text_content: content?.textContent ?? '',
        tab_id: tab.id,
        fav_icon_url: tab.favIconUrl ?? null,
        excerpt: content?.excerpt ?? null,
        site_name: content?.siteName ?? null,
      };
    }),
  );

  const data = await request<BackendSession>('/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tabs: enriched, saved_at: new Date().toISOString() }),
  });
  return mapSession(data);
}

export async function renameSession(id: string, title: string): Promise<void> {
  await request(`/sessions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
}

export async function deleteSession(id: string): Promise<void> {
  await request(`/sessions/${id}`, { method: 'DELETE' });
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function searchSessions(query: string): Promise<Session[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    const params = new URLSearchParams({ q });
    const data = await request<BackendSession[]>(`/search?${params}`);
    return data.map(mapSession);
  } catch {
    // Qdrant 미실행 등의 경우 클라이언트 필터링으로 fallback
    const sessions = await fetchSessions();
    const lower = q.toLowerCase();
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(lower) ||
        s.summary.overview.toLowerCase().includes(lower) ||
        s.tabs.some((t) => t.title.toLowerCase().includes(lower)),
    );
  }
}
