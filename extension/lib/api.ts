import { getTabPageContent } from './chrome-bridge';
import type { WireEvent } from './events/types';
import { isSensitiveUrl } from './sensitive-domains';
import { readSseStream } from './sse';
import type {
  AskStreamEvent,
  AskStreamRequest,
  AssistantRouteResult,
  MemoryEvent,
  MemorySearchResult,
  MergeSuggestion,
  Session,
  SessionSummary,
  SessionTimelineEvent,
  ServerSettings,
  OpenTabItem,
  TabActionResolveResult,
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
  last_activity_at: string | null;
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
  excluded: boolean;
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
  active_duration_ms: number;
  session_id: string | null;
  session_title: string | null;
  matched_by: 'session' | 'keyword';
}

interface BackendMemorySearchResponse {
  sessions: BackendSession[];
  events: BackendMemoryEvent[];
}

interface BackendMergeSuggestion {
  survivor_id: string;
  absorbed_id: string;
  survivor_title: string;
  absorbed_title: string;
  score: number;
  signals: { vector_score: number; keyword_overlap: string[] };
}

interface BackendServerSettings {
  auto_merge_enabled: boolean;
}

interface BackendTabActionResolveResponse {
  action: 'navigate_tab' | 'ask';
  reason: 'matched' | 'non_navigation' | 'low_confidence';
  tab_id: string | null;
  score: number | null;
  margin: number | null;
  candidates: { tab_id: string; score: number }[];
}

interface BackendAssistantRouteResponse {
  intent: 'navigate_tab' | 'find_sessions' | 'search_memory' | 'search_session';
  confidence: number | null;
  margin: number | null;
  reason: 'rule' | 'semantic' | 'fallback';
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
    lastActivityAt: b.last_activity_at ?? undefined,
    // append로 성장하는 Auto Session은 마지막 활동 시각이 사용자 기억과 맞는 기준
    timeLabel: formatTimeLabel(new Date(b.last_activity_at ?? b.created_at)),
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
    excluded: b.excluded ?? false,
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
    durationMs: b.active_duration_ms,
    sessionId: b.session_id,
    sessionTitle: b.session_title,
    matchedBy: b.matched_by,
  };
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

// ── 세션 병합 ──────────────────────────────────────────

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

// ── 서버 설정 ──────────────────────────────────────────

export async function fetchServerSettings(): Promise<ServerSettings> {
  const data = await request<BackendServerSettings>('/settings');
  return { autoMergeEnabled: data.auto_merge_enabled };
}

export async function updateServerSettings(
  patch: Partial<ServerSettings>,
): Promise<ServerSettings> {
  const body: Record<string, unknown> = {};
  if (patch.autoMergeEnabled !== undefined) {
    body.auto_merge_enabled = patch.autoMergeEnabled;
  }
  const data = await request<BackendServerSettings>('/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { autoMergeEnabled: data.auto_merge_enabled };
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

export type ServerSyncTrigger = 'manual' | 'periodic' | 'event_count' | 'idle';

/**
 * 서버 배치 세션화 트리거. 202(시작)/200(pending 없음)은 성공,
 * 409(이미 실행 중)도 정상 흐름이므로 예외로 취급하지 않는다.
 */
export async function triggerServerSync(triggerType: ServerSyncTrigger): Promise<void> {
  const res = await fetch(`${BASE}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trigger_type: triggerType }),
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(`[Orbit API] POST /sync ${res.status}`);
  }
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function resolveOpenTabAction(
  query: string,
  candidates: OpenTabItem[],
  signal?: AbortSignal,
): Promise<TabActionResolveResult> {
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
    : AbortSignal.timeout(8000);
  const data = await request<BackendTabActionResolveResponse>('/tab-actions/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      candidates: candidates.slice(0, 100).map((tab) => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        active: tab.active,
      })),
    }),
    signal: requestSignal,
  });
  return {
    action: data.action,
    reason: data.reason,
    tabId: data.tab_id,
    score: data.score,
    margin: data.margin,
    candidates: (data.candidates ?? []).map((candidate) => ({
      tabId: candidate.tab_id,
      score: candidate.score,
    })),
  };
}

export async function resolveAssistantRoute(
  query: string,
  sessionId?: string,
  signal?: AbortSignal,
): Promise<AssistantRouteResult> {
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
    : AbortSignal.timeout(8000);
  const data = await request<BackendAssistantRouteResponse>('/assistant/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, session_id: sessionId ?? null }),
    signal: requestSignal,
  });
  return data;
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
/** date는 'today' 또는 'YYYY-MM-DD' — 백엔드 GET /events가 둘 다 지원한다. */
export async function fetchEventsByDate(date: string): Promise<TodayEvent[]> {
  const data = await request<BackendTodayEvent[]>(`/events?date=${encodeURIComponent(date)}`);
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

export async function* streamAsk(
  body: AskStreamRequest,
  signal?: AbortSignal,
): AsyncGenerator<AskStreamEvent> {
  const response = await fetch(`${BASE}/ask/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      query: body.query,
      session_id: body.sessionId ?? null,
      rerank: body.rerank ?? true,
      intent: body.intent ?? 'search_memory',
    }),
    signal,
  });
  if (!response.ok) {
    const responseBody = await response.text().catch(() => '');
    throw new Error(`[Orbit API] POST /ask/stream ${response.status}: ${responseBody}`);
  }
  if (!response.body) throw new Error('[Orbit API] Ask stream body is missing');

  for await (const frame of readSseStream(response.body)) {
    const data = JSON.parse(frame.data) as Record<string, unknown>;
    if (frame.event === 'sources') {
      const sessions = Array.isArray(data.sessions) ? data.sessions as BackendSession[] : [];
      yield { type: 'sources', sessions: sessions.map(mapSession) };
    } else if (frame.event === 'delta') {
      yield { type: 'delta', text: typeof data.text === 'string' ? data.text : '' };
    } else if (frame.event === 'done') {
      yield { type: 'done', model: typeof data.model === 'string' ? data.model : null };
    } else if (frame.event === 'error') {
      yield {
        type: 'error',
        code: typeof data.code === 'string' ? data.code : 'generation_failed',
        partial: data.partial === true,
        retryable: data.retryable !== false,
      };
    }
  }
}

/** 개인정보 통제 목적 — 서버에 이미 저장된 이벤트를 개별 삭제한다 (docs/api-design-v2.md §10). */
export async function deleteServerEvent(eventId: string): Promise<void> {
  await request(`/events/${eventId}`, { method: 'DELETE' });
}

// ── Exploration Analytics (docs/api-design-v2.md §9) ──────────────────
// TimelineView 하단 요약 카드용 — 세션별 탐색 시간/도메인 방문 수만 사용한다.
// 집계 쿼리만 수행하는 엔드포인트라 AI 호출은 없고, 배열 필드는 백엔드 구현
// 상황에 따라 없을 수 있어 옵셔널로 두고 빈 배열로 정규화한다.

export interface AnalyticsSessionDuration {
  sessionId: string;
  title: string;
  totalActiveDurationMs: number;
}

export interface AnalyticsDomainCount {
  domain: string;
  visitCount: number;
}

export interface AnalyticsOverview {
  periodDays: number;
  topSessionsByDuration: AnalyticsSessionDuration[];
  topDomains: AnalyticsDomainCount[];
}

interface BackendAnalyticsSessionDuration {
  session_id: string;
  title: string;
  total_active_duration_ms: number;
}

interface BackendAnalyticsDomainCount {
  domain: string;
  visit_count: number;
}

interface BackendAnalyticsOverview {
  period_days?: number;
  top_sessions_by_duration?: BackendAnalyticsSessionDuration[];
  top_domains?: BackendAnalyticsDomainCount[];
}

export async function fetchAnalyticsOverview(days: number): Promise<AnalyticsOverview> {
  const data = await request<BackendAnalyticsOverview>(`/analytics/overview?days=${days}`);
  return {
    periodDays: data.period_days ?? days,
    topSessionsByDuration: (data.top_sessions_by_duration ?? []).map((s) => ({
      sessionId: s.session_id,
      title: s.title,
      totalActiveDurationMs: s.total_active_duration_ms,
    })),
    topDomains: (data.top_domains ?? []).map((d) => ({
      domain: d.domain,
      visitCount: d.visit_count,
    })),
  };
}
