import type {
  AnalyticsOverview,
  AppSettings,
  MergeSuggestion,
  Session,
  SessionSummary,
} from './types';

const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

// ── 백엔드 응답 타입 (snake_case) ──────────────────────

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
  summary_status: 'pending' | 'done' | 'failed';
  tabs: BackendTab[];
  created_at: string;
  updated_at: string;
  last_activity_at: string | null;
}

// ── 타입 변환 ──────────────────────────────────────────

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
    // append로 성장하는 Auto Session은 마지막 활동 시각이 사용자 기억과 맞는 기준
    timeLabel: formatTimeLabel(new Date(b.last_activity_at ?? b.created_at)),
    summary: mapSummary(b.summary),
    summaryStatus: b.summary_status,
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

// ── 공개 API ──────────────────────────────────────────

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

export async function retrySummary(id: string): Promise<Session> {
  const data = await request<BackendSession>(`/sessions/${id}/retry-summary`, {
    method: 'POST',
  });
  return mapSession(data);
}

export async function searchSessions(query: string): Promise<Session[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    const params = new URLSearchParams({ q });
    const data = await request<BackendSession[]>(`/search?${params}`);
    return data.map(mapSession);
  } catch {
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

// ── Exploration Analytics (docs/api-design-v2.md §9) ──────────────────
// 집계 쿼리만 수행하는 엔드포인트 — AI 호출 없음. 각 배열 필드는 백엔드 구현
// 상황에 따라 없을 수 있어 옵셔널로 두고 빈 배열로 정규화한다.

interface BackendAnalyticsSessionDuration {
  session_id: string;
  title: string;
  total_active_duration_ms: number;
}

interface BackendAnalyticsDomainCount {
  domain: string;
  visit_count: number;
}

interface BackendAnalyticsRepeatVisit {
  normalized_url: string;
  title: string;
  visit_count: number;
}

interface BackendAnalyticsRepeatSearchQuery {
  search_query: string;
  count: number;
}

interface BackendAnalyticsDailyTrendPoint {
  date: string;
  event_count: number;
  total_active_duration_ms: number;
}

interface BackendAnalyticsOverview {
  period_days?: number;
  top_sessions_by_duration?: BackendAnalyticsSessionDuration[];
  top_domains?: BackendAnalyticsDomainCount[];
  repeat_visits?: BackendAnalyticsRepeatVisit[];
  repeat_search_queries?: BackendAnalyticsRepeatSearchQuery[];
  daily_trend?: BackendAnalyticsDailyTrendPoint[];
}

function mapAnalyticsOverview(b: BackendAnalyticsOverview, days: number): AnalyticsOverview {
  return {
    periodDays: b.period_days ?? days,
    topSessionsByDuration: (b.top_sessions_by_duration ?? []).map((s) => ({
      sessionId: s.session_id,
      title: s.title,
      totalActiveDurationMs: s.total_active_duration_ms,
    })),
    topDomains: (b.top_domains ?? []).map((d) => ({
      domain: d.domain,
      visitCount: d.visit_count,
    })),
    repeatVisits: (b.repeat_visits ?? []).map((v) => ({
      normalizedUrl: v.normalized_url,
      title: v.title,
      visitCount: v.visit_count,
    })),
    repeatSearchQueries: (b.repeat_search_queries ?? []).map((q) => ({
      searchQuery: q.search_query,
      count: q.count,
    })),
    dailyTrend: (b.daily_trend ?? []).map((d) => ({
      date: d.date,
      eventCount: d.event_count,
      totalActiveDurationMs: d.total_active_duration_ms,
    })),
  };
}

export async function fetchAnalyticsOverview(days: number): Promise<AnalyticsOverview> {
  const data = await request<BackendAnalyticsOverview>(`/analytics/overview?days=${days}`);
  return mapAnalyticsOverview(data, days);
}

// ── 세션 병합 (merge P1·P4, docs/merge-design.md §6) ──────────────────

interface BackendMergeSuggestion {
  survivor_id: string;
  absorbed_id: string;
  survivor_title: string;
  absorbed_title: string;
  score: number;
  signals: { vector_score: number; keyword_overlap: string[] };
}

function mapMergeSuggestion(b: BackendMergeSuggestion): MergeSuggestion {
  return {
    survivorId: b.survivor_id,
    absorbedId: b.absorbed_id,
    survivorTitle: b.survivor_title,
    absorbedTitle: b.absorbed_title,
    score: b.score,
    keywordOverlap: b.signals?.keyword_overlap ?? [],
  };
}

export async function fetchMergeSuggestions(): Promise<MergeSuggestion[]> {
  const data = await request<BackendMergeSuggestion[]>('/sessions/merge-suggestions');
  return data.map(mapMergeSuggestion);
}

export async function mergeSessions(survivorId: string, absorbedId: string): Promise<void> {
  await request(`/sessions/${survivorId}/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ absorbed_id: absorbedId }),
  });
}

export async function unmergeSessions(survivorId: string, absorbedId: string): Promise<void> {
  await request(`/sessions/${survivorId}/unmerge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ absorbed_id: absorbedId }),
  });
}

// ── 앱 설정 (사용자 토글, merge 자동병합 등) ──────────────────────────

interface BackendAppSettings {
  auto_merge_enabled: boolean;
}

export async function fetchSettings(): Promise<AppSettings> {
  const d = await request<BackendAppSettings>('/settings');
  return { autoMergeEnabled: d.auto_merge_enabled };
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const body: Record<string, unknown> = {};
  if (patch.autoMergeEnabled !== undefined) body.auto_merge_enabled = patch.autoMergeEnabled;
  const d = await request<BackendAppSettings>('/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { autoMergeEnabled: d.auto_merge_enabled };
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}
