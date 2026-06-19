// Orbit 도메인 타입 — 프론트/백엔드 간 계약의 기준이 됩니다.
// (백엔드 구현 시 Pydantic 스키마와 정합을 맞춥니다.)

export interface TabItem {
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
}
