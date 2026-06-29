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
}
