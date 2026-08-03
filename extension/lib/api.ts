import { getTabPageContent } from './chrome-bridge';
import type { WireEvent } from './events/types';
import { isSensitiveUrl } from './sensitive-domains';
import type {
  MemoryEvent,
  MemorySearchResult,
  Session,
  SessionSummary,
  SessionTimelineEvent,
  TabItem,
  TodayEvent,
} from './types';

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
  summary_status: 'pending' | 'done' | 'failed';
  tabs: BackendTab[];
  created_at: string;
  updated_at: string;
}

interface BackendTodayEvent {
  event_id: string;
  url: string;
  title: string;
  domain: string;
  visited_at: string;
  active_duration_ms: number;
  session_id: string | null;
  session_title: string | null;
}

interface BackendSessionTimelineEvent {
  event_id: string;
  url: string;
  title: string;
  domain: string;
  visited_at: string;
  active_duration_ms: number;
  relevance_score: number | null;
  sequence_order: number;
}

interface BackendMemoryEvent {
  event_id: string;
  url: string;
  title: string;
  domain: string;
  visited_at: string;
  session_id: string | null;
  relevance_score: number | null;
  match_reason: 'session_relevance' | 'text_match';
}

interface BackendMemorySearchResponse {
  sessions: BackendSession[];
  events: BackendMemoryEvent[];
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
    summaryStatus: b.summary_status,
  };
}

function mapTodayEvent(b: BackendTodayEvent): TodayEvent {
  return {
    eventId: b.event_id,
    url: b.url,
    title: b.title,
    domain: b.domain,
    visitedAt: b.visited_at,
    durationMs: b.active_duration_ms,
    sessionId: b.session_id,
    sessionTitle: b.session_title,
  };
}

function mapSessionTimelineEvent(b: BackendSessionTimelineEvent): SessionTimelineEvent {
  return {
    eventId: b.event_id,
    url: b.url,
    title: b.title,
    domain: b.domain,
    visitedAt: b.visited_at,
    durationMs: b.active_duration_ms,
    relevanceScore: b.relevance_score,
    sequenceOrder: b.sequence_order,
  };
}

function mapMemoryEvent(b: BackendMemoryEvent): MemoryEvent {
  return {
    eventId: b.event_id,
    url: b.url,
    title: b.title,
    domain: b.domain,
    visitedAt: b.visited_at,
    sessionId: b.session_id,
    relevanceScore: b.relevance_score,
    matchReason: b.match_reason,
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

/**
 * 세션 상세의 "탐색 타임라인" 섹션용 (docs/api-design-v2.md §6).
 * `origin='snapshot'` 세션(이벤트 연결 없음)은 빈 배열을 반환하고, 조회 자체가 실패해도
 * (백엔드 미연결 등) 섹션을 조용히 숨길 수 있도록 빈 배열로 완화한다 — 기존 화면과
 * 독립적으로 배포 가능해야 한다는 계약(docs/IA.md 세션 상세)에 따른 처리.
 */
export async function fetchSessionEvents(sessionId: string): Promise<SessionTimelineEvent[]> {
  try {
    const data = await request<BackendSessionTimelineEvent[]>(`/sessions/${sessionId}/events`);
    return data.map(mapSessionTimelineEvent).sort((a, b) => a.sequenceOrder - b.sequenceOrder);
  } catch {
    return [];
  }
}

async function enrichTabs(tabs: TabItem[], opts: { excludeSensitive: boolean }) {
  const { excludeSensitive } = opts;

  return Promise.all(
    tabs.map(async (tab) => {
      // 민감 도메인/경로는 본문만 제외 — 탭 자체(제목·URL)는 유지해 세션 복원은 가능하게 함
      if (excludeSensitive && isSensitiveUrl(tab.url)) {
        return {
          url: tab.url,
          title: tab.title,
          text_content: '',
          tab_id: tab.id,
          fav_icon_url: tab.favIconUrl ?? null,
          excerpt: null,
          site_name: null,
        };
      }

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
}

export async function saveSessionsClustered(
  tabs: TabItem[],
  opts: { excludeSensitive: boolean },
): Promise<Session[]> {
  const enriched = await enrichTabs(tabs, opts);
  const data = await request<BackendSession[]>('/sessions/cluster', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tabs: enriched }),
  });
  return data.map(mapSession);
}

export async function retrySummary(id: string): Promise<Session> {
  const data = await request<BackendSession>(`/sessions/${id}/retry-summary`, {
    method: 'POST',
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

// ── 이벤트 배치 동기화 (docs/api-design-v2.md §1) ──────────────────

export interface EventBatchResponse {
  accepted: number;
  duplicates: number;
  filtered: number;
  pending_total: number;
}

export async function postEventBatch(
  deviceId: string,
  events: WireEvent[],
): Promise<EventBatchResponse> {
  return request<EventBatchResponse>('/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId, events }),
  });
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export interface SearchResult {
  sessions: Session[];
  /** true면 백엔드/Qdrant 미연결로 로컬 substring 검색으로 대체된 결과 (AI 정렬 라벨 억제용) */
  degraded: boolean;
}

export async function searchSessions(query: string, rerank = false): Promise<SearchResult> {
  const q = query.trim();
  if (!q) return { sessions: [], degraded: false };
  try {
    const params = new URLSearchParams({ q });
    if (rerank) params.set('rerank', 'true');
    const data = await request<BackendSession[]>(`/search?${params}`);
    return { sessions: data.map(mapSession), degraded: false };
  } catch {
    // 백엔드/Qdrant 미연결 등의 경우 클라이언트 substring 필터링으로 fallback
    const sessions = await fetchSessions();
    const lower = q.toLowerCase();
    const filtered = sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(lower) ||
        s.summary.overview.toLowerCase().includes(lower) ||
        s.tabs.some((t) => t.title.toLowerCase().includes(lower)),
    );
    return { sessions: filtered, degraded: true };
  }
}

// ── Timeline / Memory 검색 (M4, docs/api-design-v2.md §3, §8, §10) ─────

/** Timeline 홈용 — 서버에 이미 동기화된 오늘자 이벤트만 반환한다(미동기화분은 로컬 IDB에서 읽음). */
export async function fetchTodayEvents(): Promise<TodayEvent[]> {
  const data = await request<BackendTodayEvent[]>('/events?date=today');
  return data.map(mapTodayEvent);
}

/**
 * scope=memory 검색 — 세션/이벤트 두 그룹을 함께 반환한다.
 * 실패 시 기존 searchSessions와 동일한 substring fallback을 쓰되, 이벤트 그룹은 항상 비운다
 * (로컬에는 세션 텍스트만 있고 이벤트 인덱스가 없어 fallback으로 재현할 수 없음).
 */
export async function searchMemory(query: string, rerank = false): Promise<MemorySearchResult> {
  const q = query.trim();
  if (!q) return { sessions: [], events: [], degraded: false };
  try {
    const params = new URLSearchParams({ q, scope: 'memory' });
    if (rerank) params.set('rerank', 'true');
    const data = await request<BackendMemorySearchResponse>(`/search?${params}`);
    return {
      sessions: data.sessions.map(mapSession),
      events: data.events.map(mapMemoryEvent),
      degraded: false,
    };
  } catch {
    const sessions = await fetchSessions();
    const lower = q.toLowerCase();
    const filtered = sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(lower) ||
        s.summary.overview.toLowerCase().includes(lower) ||
        s.tabs.some((t) => t.title.toLowerCase().includes(lower)),
    );
    return { sessions: filtered, events: [], degraded: true };
  }
}

/** 개인정보 통제 목적 — 서버에 이미 저장된 이벤트를 개별 삭제한다 (docs/api-design-v2.md §10). */
export async function deleteServerEvent(eventId: string): Promise<void> {
  await request(`/events/${eventId}`, { method: 'DELETE' });
}
