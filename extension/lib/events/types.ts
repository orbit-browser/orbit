// 방문 이벤트 도메인 타입 — 로컬 큐(camelCase) ↔ 서버 wire(snake_case) 변환 경계.
// 계약 근거: docs/api-design-v2.md §1, docs/target-architecture.md §2.1, backend/app/schemas/event.py

export type EventStatus = 'open' | 'pending' | 'syncing' | 'synced';
export type EventSource = 'browser';
export type EventType = 'visit' | 'spa_nav';

export interface ExplorationEvent {
  /** crypto.randomUUID() — 서버 인제스트 멱등 키(PK)로도 그대로 쓰인다. */
  eventId: string;
  eventType: EventType;
  url: string;
  title: string;
  /** URL host — 로컬 그룹핑/디버깅용. 서버는 인제스트 시점에 자체 계산하므로 wire에는 포함하지 않는다. */
  domain: string;
  /** ISO 8601 */
  visitedAt: string;
  /** ISO 8601 — 아직 진행 중(open)이면 null */
  endedAt: string | null;
  tabId: number;
  windowId: number;
  /** 같은 탭의 직전 URL (첫 방문이면 null) */
  referrerUrl: string | null;
  /** 같은 탭의 직전 이벤트 id (체이닝용, 첫 방문이면 null) */
  previousEventId: string | null;
  activeDurationMs: number;
  /** Readability 추출 본문 발췌, 최대 4000자. 미부착 시 null */
  contentExcerpt: string | null;
  /** ISO 8601 — 로컬 큐에 처음 적재된 시각 */
  createdAt: string;

  // ── 로컬 전용 상태 — toWire()에서 제외 ──────────────────────────
  status: EventStatus;
  /** 동기화 실패 횟수 — 지수 백오프 계산에 사용 */
  failureCount: number;
  /** ISO 8601 — 이 시각 이전에는 claimPending 대상에서 제외(백오프 대기) */
  nextAttemptAt: string | null;
  /** ISO 8601 — synced로 전환된 시각(48h 후 prune 기준) */
  syncedAt: string | null;
  /**
   * ISO 8601 — claimPending이 syncing으로 전환한 시각.
   * 계약 명세(ExplorationEvent 필드 목록)에는 없는 구현상 추가 필드로,
   * resetStaleSyncing이 SW 재시작 후 고아 상태가 된 이벤트를 판별하는 데만 쓰인다.
   */
  syncingStartedAt: string | null;
}

/** addEvent에 전달하는 입력 — 로컬 전용 상태 필드는 큐가 채운다. */
export type NewEventInput = Omit<
  ExplorationEvent,
  'status' | 'failureCount' | 'nextAttemptAt' | 'syncedAt' | 'createdAt' | 'syncingStartedAt'
>;

/** POST /events가 받는 이벤트 1건의 wire 포맷 (backend/app/schemas/event.py::ExplorationEventIn 기준) */
export interface WireEvent {
  id: string;
  source: EventSource;
  url: string;
  title: string;
  visited_at: string;
  ended_at: string | null;
  active_duration_ms: number;
  tab_id: number;
  window_id: number;
  previous_event_id: string | null;
  referrer_url: string | null;
  event_type: EventType;
  /**
   * 서버 스키마(ExplorationEventIn.content_excerpt)는 `str = ""`로 선언되어 있어
   * null을 허용하지 않는다 — 계약 문서(api-design-v2.md)의 예시는 `"content_excerpt": null`을
   * 보여주지만, 실제 Pydantic 스키마가 최종 근거이므로 null은 빈 문자열로 치환해 보낸다.
   */
  content_excerpt: string;
}

export function toWire(event: ExplorationEvent): WireEvent {
  return {
    id: event.eventId,
    source: 'browser',
    url: event.url,
    title: event.title,
    visited_at: event.visitedAt,
    ended_at: event.endedAt,
    active_duration_ms: event.activeDurationMs,
    tab_id: event.tabId,
    window_id: event.windowId,
    previous_event_id: event.previousEventId,
    referrer_url: event.referrerUrl,
    event_type: event.eventType,
    content_excerpt: event.contentExcerpt ?? '',
  };
}

export function domainFromUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return '';
  }
}

export const MAX_CONTENT_EXCERPT_LENGTH = 4000;
