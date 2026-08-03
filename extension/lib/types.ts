// Orbit 도메인 타입 — 프론트/백엔드 간 계약의 기준이 됩니다.
// (백엔드 구현 시 Pydantic 스키마와 정합을 맞춥니다.)

export interface PageContent {
  title: string;
  /** Readability가 추출한 순수 텍스트 (임베딩 입력용, 최대 8000자) */
  textContent: string;
  /** 짧은 발췌문 (UI 미리보기 / LLM 요약용) */
  excerpt: string;
  byline?: string;
  siteName?: string;
  length: number;
}

export interface TabItem {
  /** chrome.tabs.Tab.id (항상 실제 탭 ID — parseInt 가능) */
  id: string;
  title: string;
  url: string;
  favIconUrl?: string;
}

export interface SessionSummary {
  /** 한 줄 개요 */
  overview: string;
  /** 탐색 목적 */
  purpose?: string;
  /** 핵심 정보 */
  highlights: string[];
  /** 미완료 작업 */
  todos?: string[];
  /** 다음 행동 */
  nextActions?: string[];
}

export interface Session {
  id: string;
  title: string;
  tabs: TabItem[];
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601 */
  updatedAt: string;
  /** 목록에 표시할 상대 시간 라벨 (mock 표시용) */
  timeLabel: string;
  summary: SessionSummary;
  /** AI 요약 진행 상태 — pending/failed일 때 UI가 스피너·재시도 버튼을 노출 */
  summaryStatus: 'pending' | 'done' | 'failed';
}

// ── Timeline / Memory 검색 (M4, docs/api-design-v2.md §3, §6, §8) ──────────

/** GET /events?date=today 응답 매핑 — 서버에 이미 동기화된 오늘자 이벤트. */
export interface TodayEvent {
  eventId: string;
  url: string;
  title: string;
  domain: string;
  /** ISO 8601 */
  visitedAt: string;
  durationMs: number;
  /** 아직 세션에 배정되지 않았으면 null */
  sessionId: string | null;
  sessionTitle: string | null;
}

/** GET /sessions/{id}/events 응답 매핑 — 세션 상세의 "탐색 타임라인" 섹션용. */
export interface SessionTimelineEvent {
  eventId: string;
  url: string;
  title: string;
  domain: string;
  /** ISO 8601 */
  visitedAt: string;
  durationMs: number;
  relevanceScore: number | null;
  sequenceOrder: number;
}

/** GET /search?scope=memory 응답의 events 배열 항목. */
export interface MemoryEvent {
  eventId: string;
  url: string;
  title: string;
  domain: string;
  /** ISO 8601 */
  visitedAt: string;
  durationMs: number;
  sessionId: string | null;
  sessionTitle: string | null;
  matchedBy: 'session' | 'keyword';
}

/** GET /search?scope=memory 응답 전체 매핑. */
export interface MemorySearchResult {
  sessions: Session[];
  events: MemoryEvent[];
  /** true면 백엔드 미연결로 세션 substring fallback을 사용한 결과 (이벤트는 항상 빈 배열) */
  degraded: boolean;
}
