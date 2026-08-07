import type { Folder, Session, SessionTimelineEvent } from '../../../../lib/types';

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
  /** 사용자가 넣은 폴더. 없으면 미정리. */
  folderId?: string;
}

/** 폴더 하나와 그 안에 정리된 세션들. */
export interface FolderNode {
  id: string;
  name: string;
  hue: string;
  position: number;
  sessions: SessionNode[];
}

export type SessionEventsById = ReadonlyMap<string, SessionTimelineEvent[]>;

const SESSION_HUES = ['#ef6f47', '#e09528', '#7fa452', '#3aa09a', '#727bcb', '#c06aa2'];

/**
 * 궤도 앞면(사용자에게 보이는 반원)에 동시에 놓이는 점의 수.
 *
 * 각도가 아니라 **슬롯**으로 센다 — 궤도에 따라 점을 놓을 수 있는 각도 구간이
 * 다르기 때문이다(세션 칩이 놓인 궤도는 최하단을 비워야 한다). 슬롯 번호에서
 * 실제 각도로 바꾸는 일은 캔버스가 맡는다.
 */
export const ORBIT_VISIBLE_SLOTS = 7;

/** 궤도 하나가 담는 총량 — 앞면 절반, 뒤편 절반. */
export const ORBIT_CAPACITY = ORBIT_VISIBLE_SLOTS * 2;

export function splitPagesIntoOrbits<T>(items: T[], limit = ORBIT_CAPACITY): T[][] {
  if (limit < 1) throw new Error('Orbit page limit must be at least 1');
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += limit) {
    groups.push(items.slice(index, index + limit));
  }
  return groups;
}

/**
 * index 번째 점이 놓인 슬롯 번호.
 *
 * rotation을 1 올리면 앞면 첫 슬롯의 점이 뒤편으로 넘어가고 뒤에 있던 점이
 * 마지막 슬롯으로 올라온다.
 */
export function orbitSlot(index: number, rotation: number, total: number): number {
  if (total <= 0) return 0;
  return (((index - rotation) % total) + total) % total;
}

/** 앞면 슬롯인지 — 뒤편 점은 아예 렌더링하지 않는다. */
export const isVisibleSlot = (slot: number) => slot < ORBIT_VISIBLE_SLOTS;

/** 회전량을 아이템 수 안에서 순환시킨다. 한 바퀴를 넘겨도 제자리로 돌아온다. */
export function normalizeRotation(rotation: number, total: number): number {
  if (total <= 0) return 0;
  return ((rotation % total) + total) % total;
}

/** 지금 앞면에 보이는 점들의 원본 인덱스. 회전 상태 표시(현재/전체)에 쓴다. */
export function visibleIndices(total: number, rotation: number): number[] {
  const out: number[] = [];
  for (let index = 0; index < total; index += 1) {
    if (isVisibleSlot(orbitSlot(index, rotation, total))) out.push(index);
  }
  return out;
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
    folderId: session.folderId,
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

// ── 캔버스 씬 ─────────────────────────────────────────────────────────
//
// 폴더 뷰(중심=폴더, 궤도=세션)와 미정리 뷰(중심=세션, 궤도=페이지 묶음)는
// 의미만 다르고 그리는 구조가 같다. 캔버스가 두 경우를 나눠 알지 않도록
// 여기서 하나의 씬 형태로 변환한다.

export interface OrbitPoint {
  id: string;
  title: string;
  domain: string;
  minutes: number;
  visits: number;
}

/** 궤도 최하단에 붙는 세션 칩. 궤도가 세션을 대표할 때만 존재한다. */
export interface OrbitChip {
  date: string;
  minutes: number;
  status: SessionNode['status'];
}

export interface OrbitTrack {
  id: string;
  label: string;
  hue: string;
  /** 궤도 위의 점 전체. 앞면 정원을 넘는 만큼은 뒤편에 보관된다. */
  points: OrbitPoint[];
  /** 이 궤도가 대표하는 세션 — 폴더 씬에서만 값이 있다. */
  sessionId: string | null;
  /** 칩이 있으면 궤도 최하단이 칩 자리라 점을 좌우로 갈라 놓는다. */
  chip: OrbitChip | null;
}

export interface OrbitScene {
  kind: 'folder' | 'session';
  id: string;
  title: string;
  meta: string;
  hue: string;
  tracks: OrbitTrack[];
}

const pageToPoint = (page: PageNode): OrbitPoint => ({
  id: page.id,
  title: page.title,
  domain: page.domain,
  minutes: page.minutes,
  visits: page.visits,
});

/** 중심=세션, 궤도=페이지 묶음. 페이지가 궤도 정원을 넘으면 바깥 궤도로 이어진다. */
export function buildSessionScene(session: SessionNode): OrbitScene {
  const groups = splitPagesIntoOrbits(session.pages);
  return {
    kind: 'session',
    id: session.id,
    title: session.title,
    meta: `페이지 ${session.pages.length} · ${formatMinutes(session.minutes)} · ${session.date}`,
    hue: session.hue,
    tracks: groups.map((pages, index) => ({
      id: `${session.id}-orbit-${index}`,
      // 궤도가 하나뿐이면 라벨을 비운다 — 중심 노드 아래 제목과 똑같은 글자가 겹친다.
      label: groups.length > 1 ? `${index + 1}번째 궤도` : '',
      hue: session.hue,
      points: pages.map(pageToPoint),
      sessionId: null,
      chip: null,
    })),
  };
}

/** 중심=폴더, 궤도 한 줄=세션 하나, 그 궤도의 점=해당 세션의 페이지. */
export function buildFolderScene(folder: FolderNode): OrbitScene {
  const pageCount = folder.sessions.reduce((sum, session) => sum + session.pages.length, 0);
  const minutes = folder.sessions.reduce((sum, session) => sum + session.minutes, 0);
  return {
    kind: 'folder',
    id: folder.id,
    title: folder.name,
    meta: `세션 ${folder.sessions.length} · 페이지 ${pageCount} · ${formatMinutes(minutes)}`,
    hue: folder.hue,
    tracks: folder.sessions.map((session) => ({
      id: session.id,
      label: session.title,
      hue: session.hue,
      points: session.pages.map(pageToPoint),
      sessionId: session.id,
      chip: { date: session.date, minutes: session.minutes, status: session.status },
    })),
  };
}

/**
 * 세션을 폴더별로 나눈다.
 *
 * 존재하지 않는 폴더를 가리키는 세션은 미정리로 돌린다 — 다른 기기에서 폴더가
 * 지워졌는데 세션 목록이 먼저 도착하면 그 세션이 어디에도 안 보이게 된다.
 */
export function buildFolderNodes(
  folders: Folder[],
  sessions: SessionNode[],
): { folders: FolderNode[]; unfiled: SessionNode[] } {
  const nodes = new Map<string, FolderNode>(
    folders.map((folder) => [
      folder.id,
      {
        id: folder.id,
        name: folder.name,
        hue: folder.hue,
        position: folder.position,
        sessions: [],
      },
    ]),
  );

  const unfiled: SessionNode[] = [];
  sessions.forEach((session) => {
    const node = session.folderId ? nodes.get(session.folderId) : undefined;
    if (node) node.sessions.push(session);
    else unfiled.push(session);
  });

  const ordered = [...nodes.values()].sort(
    (a, b) => a.position - b.position || a.name.localeCompare(b.name),
  );
  return { folders: ordered, unfiled };
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


/**
 * 세션을 대표하는 페이지 하나.
 *
 * 가장 많이 등장한 도메인의 첫 페이지를 고른다 — 세션에서 중심이 된 사이트가
 * 그 세션을 가장 잘 설명한다. 동률이면 먼저 방문한 쪽을 쓴다(결정적).
 */
export function representativePage(session: SessionNode): PageNode | null {
  if (session.pages.length === 0) return null;

  const countByDomain = new Map<string, number>();
  session.pages.forEach((page) => {
    const key = page.domain.toLowerCase();
    countByDomain.set(key, (countByDomain.get(key) ?? 0) + 1);
  });

  let best = session.pages[0];
  let bestCount = countByDomain.get(best.domain.toLowerCase()) ?? 0;
  for (const page of session.pages) {
    const count = countByDomain.get(page.domain.toLowerCase()) ?? 0;
    if (count > bestCount) {
      best = page;
      bestCount = count;
    }
  }
  return best;
}
