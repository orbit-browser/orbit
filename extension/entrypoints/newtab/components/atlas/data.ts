import type { Session, SessionTimelineEvent } from '../../../../lib/types';

export interface PageNode {
  id: string;
  title: string;
  url: string;
  domain: string;
  /** 체류 시간(분). */
  minutes: number;
  /** 같은 URL을 방문한 횟수. */
  visits: number;
}

export interface SessionSummary {
  overview: string;
  highlights: string[];
  nextActions: string[];
}

export interface SessionNode {
  id: string;
  title: string;
  /** 사용자에게 보여 줄 상대 날짜 라벨. */
  date: string;
  /** 세션 총 활성 시간(분). */
  minutes: number;
  status: 'live' | 'recent' | 'archived';
  category: string;
  icon: string;
  hue: string;
  summary: SessionSummary;
  pages: PageNode[];
}

export type SessionEventsById = ReadonlyMap<string, SessionTimelineEvent[]>;

const SESSION_HUES = ['#ef6f47', '#e09528', '#7fa452', '#3aa09a', '#727bcb', '#c06aa2'];

export const PAGES_PER_ORBIT = 8;

export function splitPagesIntoOrbits<T>(items: T[], limit = PAGES_PER_ORBIT): T[][] {
  if (limit < 1) throw new Error('Orbit page limit must be at least 1');
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += limit) {
    groups.push(items.slice(index, index + limit));
  }
  return groups;
}

const minutesFromMs = (durationMs: number) =>
  durationMs <= 0 ? 0 : Math.max(1, Math.round(durationMs / 60_000));

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toUpperCase();
  } catch {
    return url;
  }
}

function pagesFromEvents(events: SessionTimelineEvent[]): PageNode[] {
  const ordered = events.slice().sort((a, b) => a.sequenceOrder - b.sequenceOrder);
  const visitsByUrl = new Map<string, number>();
  ordered.forEach((event) => visitsByUrl.set(event.url, (visitsByUrl.get(event.url) ?? 0) + 1));

  return ordered.map((event) => ({
    id: event.eventId,
    title: event.title || event.domain || event.url,
    url: event.url,
    domain: (event.domain || domainFromUrl(event.url)).toUpperCase(),
    minutes: minutesFromMs(event.durationMs),
    visits: visitsByUrl.get(event.url) ?? 1,
  }));
}

function pagesFromTabs(session: Session): PageNode[] {
  return session.tabs.map((tab, index) => ({
    id: tab.id || `${session.id}-tab-${index}`,
    title: tab.title || domainFromUrl(tab.url),
    url: tab.url,
    domain: domainFromUrl(tab.url),
    minutes: 0,
    visits: 1,
  }));
}

const activityAt = (session: Session) =>
  new Date(session.lastActivityAt ?? session.updatedAt ?? session.createdAt);

function hueForSession(id: string): string {
  const hash = [...id].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0);
  return SESSION_HUES[hash % SESSION_HUES.length];
}

function relativeDate(date: Date, now: Date): string {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.max(0, Math.floor((start - target) / 86_400_000));
  if (days === 0) return '오늘';
  if (days === 1) return '어제';
  if (days < 14) return `${days}일 전`;
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function sessionStatus(date: Date, now: Date): SessionNode['status'] {
  const ageMs = Math.max(0, now.getTime() - date.getTime());
  if (ageMs <= 30 * 60_000) return 'live';
  if (ageMs <= 7 * 86_400_000) return 'recent';
  return 'archived';
}

export function toSessionNode(
  session: Session,
  events: SessionTimelineEvent[],
  now = new Date(),
): SessionNode {
  const activity = activityAt(session);
  const pages = events.length > 0 ? pagesFromEvents(events) : pagesFromTabs(session);
  const totalDurationMs = events.reduce((sum, event) => sum + event.durationMs, 0);

  return {
    id: session.id,
    title: session.title,
    date: relativeDate(activity, now),
    minutes: minutesFromMs(totalDurationMs),
    status: sessionStatus(activity, now),
    category: '탐색 세션',
    icon: 'ph-circles-three',
    hue: hueForSession(session.id),
    summary: {
      overview: session.summary.overview,
      highlights: session.summary.highlights,
      nextActions: session.summary.nextActions ?? session.summary.todos ?? [],
    },
    pages,
  };
}

/**
 * 현재 백엔드에는 Orbit 엔티티가 없다. 주제를 임의로 만들어내지 않고 실제 세션을
 * Atlas의 중심 노드로 직접 사용한다.
 */
export function buildAtlasSessions(
  sessions: Session[],
  eventsBySession: SessionEventsById,
  now = new Date(),
): SessionNode[] {
  return sessions
    .slice()
    .sort((a, b) => activityAt(b).getTime() - activityAt(a).getTime())
    .map((session) => toSessionNode(session, eventsBySession.get(session.id) ?? [], now));
}

export const formatMinutes = (minutes: number) => {
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}시간` : `${hours}시간 ${rest}분`;
};

export const mostRevisitedPage = (session: SessionNode): PageNode | null =>
  session.pages.reduce<PageNode | null>(
    (top, page) => (!top || page.visits > top.visits ? page : top),
    null,
  );

export const topDomains = (session: SessionNode, limit = 3) => {
  const counts = new Map<string, number>();
  session.pages.forEach((page) => {
    counts.set(page.domain, (counts.get(page.domain) ?? 0) + 1);
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([domain, count]) => ({ domain, count }));
};
