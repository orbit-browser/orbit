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

/** 현재 브라우저 세션에 열려 있어 직접 활성화할 수 있는 탭. */
export interface OpenTabItem extends TabItem {
  windowId: number;
  index: number;
  active: boolean;
  /** Chrome 내부 페이지처럼 북마크 API에 넘기지 않는 URL은 false. */
  bookmarkable: boolean;
}

export interface TabActionResolveResult {
  action: 'navigate_tab' | 'ask';
  reason: 'matched' | 'non_navigation' | 'low_confidence';
  tabId: string | null;
  score: number | null;
  margin: number | null;
  candidates: { tabId: string; score: number }[];
}

export type AssistantIntent =
  | 'navigate_tab'
  | 'find_sessions'
  | 'search_memory'
  | 'search_session';

export type AssistantRetrievalIntent = Exclude<AssistantIntent, 'navigate_tab'>;

export interface AssistantRouteResult {
  intent: AssistantIntent;
  confidence: number | null;
  margin: number | null;
  reason: 'rule' | 'semantic' | 'fallback';
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
  /** 마지막 탐색 이벤트 시각. snapshot 세션처럼 값이 없으면 undefined. */
  lastActivityAt?: string;
  /** 목록에 표시할 시간 라벨 */
  timeLabel: string;
  summary: SessionSummary;
  /** AI 요약 진행 상태 — pending/failed일 때 UI가 스피너·재시도 버튼을 노출 */
  summaryStatus: 'pending' | 'done' | 'failed';
  /** 사용자가 넣은 폴더. 없으면 미정리(단일 소속). */
  folderId?: string;
}

// ── 사용자 폴더 (docs/api-design-v2.md §13) ────────────────────────────

/**
 * 사용자가 직접 만드는 세션 그룹. 자동 분류가 아니라 수동 정리 수단이며,
 * 세션은 폴더 하나에만 속한다.
 */
export interface Folder {
  id: string;
  name: string;
  /** 캔버스 중심 노드와 궤도에 쓰는 색 */
  hue: string;
  /** 표시 순서 */
  position: number;
  /** 병합으로 흡수된 세션을 뺀 소속 세션 수 */
  sessionCount: number;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601 */
  updatedAt: string;
}

/** 폴더 일괄 배정 결과 — 건너뛴 세션을 그대로 돌려준다. */
export interface FolderAssignResult {
  folderId: string;
  assigned: string[];
  skipped: string[];
}

// ── 세션 병합 제안 (docs/merge-design.md §6) ───────────────────────────

export interface MergeSuggestion {
  survivorId: string;
  absorbedId: string;
  survivorTitle: string;
  absorbedTitle: string;
  /** 두 세션 요약 임베딩의 코사인 유사도 (0~1) */
  score: number;
  /** 후보로 삼은 근거 — 겹치는 키워드/제목 토큰 */
  keywordOverlap: string[];
}

/** 백엔드에 저장되는 사용자 선택 설정. extension 로컬 수집 설정과 별개다. */
export interface ServerSettings {
  /** 다음 동기화부터 명백한 중복만 자동 병합한다. 기본값은 false. */
  autoMergeEnabled: boolean;
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
  /** 노이즈 사전 필터/LLM이 세션 대상에서 제외한 스침 방문 */
  excluded: boolean;
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

// ── Ask AI 스트리밍 ───────────────────────────────────────────────────

export interface AskStreamRequest {
  query: string;
  sessionId?: string;
  rerank?: boolean;
  intent?: AssistantRetrievalIntent;
}

export type AskStreamEvent =
  | { type: 'sources'; sessions: Session[] }
  | { type: 'delta'; text: string }
  | { type: 'done'; model: string | null }
  | {
      type: 'error';
      code: 'stream_interrupted' | 'generation_failed' | string;
      partial: boolean;
      retryable: boolean;
    };
