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
