export interface TabItem {
  id: string;
  title: string;
  url: string;
  favIconUrl?: string;
}

export interface SessionSummary {
  overview: string;
  purpose?: string;
  highlights: string[];
  todos?: string[];
  nextActions?: string[];
}

export interface Session {
  id: string;
  title: string;
  tabs: TabItem[];
  createdAt: string;
  updatedAt: string;
  timeLabel: string;
  summary: SessionSummary;
  /** AI 요약 진행 상태 — pending/failed일 때 UI가 로딩·재시도 상태를 노출 */
  summaryStatus: 'pending' | 'done' | 'failed';
}

// ── Exploration Analytics (docs/api-design-v2.md §9) ──────────────────
// 백엔드가 병렬 구현 중이므로 각 배열 필드는 없을 수 있다 — lib/api.ts에서
// 옵셔널 처리 후 빈 배열로 정규화한다.

export interface AnalyticsSessionDuration {
  sessionId: string;
  title: string;
  totalActiveDurationMs: number;
}

export interface AnalyticsDomainCount {
  domain: string;
  visitCount: number;
}

export interface AnalyticsRepeatVisit {
  normalizedUrl: string;
  title: string;
  visitCount: number;
}

export interface AnalyticsRepeatSearchQuery {
  searchQuery: string;
  count: number;
}

export interface AnalyticsDailyTrendPoint {
  date: string;
  eventCount: number;
  totalActiveDurationMs: number;
}

export interface AnalyticsOverview {
  periodDays: number;
  topSessionsByDuration: AnalyticsSessionDuration[];
  topDomains: AnalyticsDomainCount[];
  repeatVisits: AnalyticsRepeatVisit[];
  repeatSearchQueries: AnalyticsRepeatSearchQuery[];
  dailyTrend: AnalyticsDailyTrendPoint[];
}
