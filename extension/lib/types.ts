// Orbit 도메인 타입 — 프론트/백엔드 간 계약의 기준이 됩니다.
// (백엔드 구현 시 Pydantic 스키마와 정합을 맞춥니다.)

export interface PageContent {
  title: string;
  /** 정규화한 본문 텍스트 (Readability, 실패 시 iframe·화면 텍스트 폴백, 최대 MAX_CONTENT_EXCERPT_LENGTH자) */
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
  /**
   * 화면에 쓰는 이름. 사용자가 별칭을 붙였으면 별칭이고, 아니면 AI가 만든 원래 이름이다.
   * 서버가 응답 경계에서 합쳐 주므로 화면마다 다시 고를 필요가 없다.
   */
  title: string;
  /** 사용자가 붙인 별칭. 편집창 초기값과 "되돌리기" 표시에만 쓴다. */
  alias: string | null;
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
  /** 폴더 소속을 누가 정했는지. 'auto' 면 서버 자동 분류다. 정한 적 없으면 undefined. */
  folderAssignedBy?: 'user' | 'auto';
  /**
   * 이 세션이 공유된 팀 id. 목록·단건 조회에서 소유자에게만 채워진다 — 다른 응답과 팀원이 받은
   * 응답에서는 비어 있다. 공유 배지는 목록 응답을 기준으로 그린다.
   */
  sharedWorkspaceIds?: string[];
}

// ── 팀 워크스페이스 (docs/api-design-v2.md §14) ────────────────────────

export type WorkspaceRole = 'owner' | 'member';

/** 내가 속한 팀. 1단계는 세션 공유형 — 공유된 세션을 함께 보고 검색·Ask 한다. */
export interface Workspace {
  id: string;
  name: string;
  hue: string;
  role: WorkspaceRole;
  memberCount: number;
  /** ISO 8601 */
  createdAt: string;
  /** owner 가 팀 수집을 허용했는지(docs/team-collect-mode.md §1.1). */
  collectAllowed?: boolean;
  /** 이 기기에서 이 팀으로 열린 수집 창. 없으면 null. */
  myCollect?: CollectWindow | null;
}

// ── 팀 수집 모드 (docs/team-collect-mode.md §5) ───────────────────────

/** 서버가 만든 수집 창. 팀 판정의 근거는 언제나 서버의 이 행이다. */
export interface CollectWindow {
  windowId: string;
  workspaceId: string;
  deviceId: string;
  /** ISO 8601 */
  startedAt: string;
  /** ISO 8601 */
  expiresAt: string;
}

export interface CollectingMember {
  userId: string;
  name: string | null;
  picture: string | null;
  /** ISO 8601 */
  expiresAt: string;
}

export interface CollectStatus {
  allowed: boolean;
  /** 이 팀에 대한 내 모든 기기의 열린 창(다른 기기 것을 끄기 위해). */
  myWindows: CollectWindow[];
  collecting: CollectingMember[];
}

export interface CollectStartResult {
  window: CollectWindow;
  /** ISO 8601 — 기기 시계 보정 기준 */
  serverNow: string;
  endedWorkspaceId: string | null;
}

export interface WithdrawResult {
  withdrawnEvents: number;
  sessions: Session[];
  windowClosed: boolean;
}

export interface WorkspaceMember {
  userId: string;
  name: string | null;
  /** owner 와 본인에게만 채워진다 — 팀원끼리는 이름·사진만 본다. */
  email: string | null;
  picture: string | null;
  role: WorkspaceRole;
  /** ISO 8601 */
  joinedAt: string;
}

export interface MemberBrief {
  userId: string;
  name: string | null;
  picture: string | null;
}

/**
 * 팀에 공유된 세션 — 원본 세션을 가리키는 라이브 참조다. 공유 뒤 붙은 페이지도 보인다.
 * `folderId` 는 공유한 사람의 개인 폴더라 팀 화면에서는 쓰지 않는다.
 */
export interface WorkspaceSession extends Session {
  sharedBy: MemberBrief;
  /** 이 팀으로 수집된 세션인지(팀 수집 모드). */
  collected?: boolean;
  /** ISO 8601 */
  sharedAt: string;
}

/** 초대 코드는 발급 응답에서 한 번만 보인다 — 서버는 해시만 저장한다. */
export interface InviteCode {
  code: string;
  /** ISO 8601 */
  expiresAt: string;
}

/** 공유 결과 — 폴더 배정과 같이 건너뛴 세션을 그대로 돌려준다. */
export interface ShareResult {
  workspaceId: string;
  shared: string[];
  skipped: string[];
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

/** 미정리 세션을 넣을 만한 폴더 — 자동으로 넣기엔 애매해 사용자에게 묻는다. */
export interface FolderSuggestion {
  sessionId: string;
  folderId: string;
  score: number;
  /** 그 폴더 안에서 이 세션과 가장 비슷한 세션들 — 제안 근거로 보여 준다. */
  similarSessionIds: string[];
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
  /** 새 세션이 기존 폴더와 확실히 비슷하면 자동으로 넣고, 애매하면 제안한다. */
  autoFolderEnabled: boolean;
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

/** 후속 질문 해석용 이전 턴. 서버는 저장하지 않는다. */
export interface AskHistoryTurn {
  query: string;
  answer: string;
  sourceSessionIds: string[];
}

export interface AskStreamRequest {
  query: string;
  sessionId?: string;
  rerank?: boolean;
  intent?: AssistantRetrievalIntent;
  /** 주면 그 팀에 공유된 세션만 근거로 쓴다. */
  workspaceId?: string;
  /** 최근 대화(오래된 순, 최대 3턴). 비우면 독립 질문으로 처리된다. */
  history?: AskHistoryTurn[];
}

/** 답변이 한 대상의 값이라고 말한 값이 기록에서는 비슷한 다른 대상의 값인 경우 (`verification` 이벤트). */
export interface AskVerificationIssue {
  value: string;
  answerSubject: string;
  recordSubject: string;
}

export type AskStreamEvent =
  | { type: 'sources'; sessions: Session[] }
  | { type: 'delta'; text: string }
  /** 서버가 생성 뒤 검사에서 근거와 모순을 찾았을 때 이미 보낸 본문 전체를 바꾼다. */
  | { type: 'replace'; text: string }
  | { type: 'verification'; issues: AskVerificationIssue[] }
  | { type: 'done'; model: string | null }
  | {
      type: 'error';
      code: 'stream_interrupted' | 'generation_failed' | string;
      partial: boolean;
      retryable: boolean;
    };
