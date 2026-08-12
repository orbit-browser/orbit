import { hueForSession } from '../../../../lib/session-hue';
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
  /** 화면에 쓰는 이름 — 별칭이 있으면 별칭이다(서버가 합쳐 준다). */
  title: string;
  /** 사용자가 붙인 별칭. 편집창 초기값과 "되돌리기" 표시에만 쓴다. */
  alias: string | null;
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

// ── 궤도 위 점 배치 ───────────────────────────────────────────────────
//
// 궤도 앞면은 0도(왼쪽 끝)에서 180도(오른쪽 끝)까지이고, 90도가 최하단 —
// 중심 노드 바로 아래다. **선택된 점은 언제나 최하단**이고, 회전량이 곧 지금
// 최하단에 놓인 점의 인덱스다. 좌우 이동은 이 회전량을 바꾸는 일이다.

/** 최하단 기준 한쪽으로 온전히 드러내는 점의 수. */
export const ORBIT_VISIBLE_SIDE = 3;

/** 한 번에 온전히 보이는 점의 수 — 최하단 1 + 좌우 각 ORBIT_VISIBLE_SIDE. */
export const ORBIT_VISIBLE_COUNT = ORBIT_VISIBLE_SIDE * 2 + 1;

/** 온전한 구간 바깥, 궤도 양 끝에 몰아 두는 축소 점의 수(한쪽). */
export const ORBIT_EDGE_HINTS = 3;

/** 점을 놓는 각도 폭. 아크 양 끝에 딱 붙지 않도록 18도씩 남긴다. */
const ORBIT_ARC_SPAN = 144;

/** 온전한 구간을 넘어선 뒤의 간격 배율. 뒤로 돌아가며 눌리는 원근처럼 보인다. */
const EDGE_COMPRESS = 0.34;

// ── 궤도(링) 배치 ────────────────────────────────────────────────────
//
// 폴더 씬은 궤도 한 줄이 세션 하나다. 전부 같은 간격으로 그리면 세션이 늘어날수록
// 궤도도 칩도 몰려 읽을 수 없다. 그래서 **펼친 세션의 궤도를 고정 반경(초점)에 두고**
// 이웃만 안팎으로 펼친다 — 탭을 넘기듯 초점이 옮겨 가고 나머지는 미끄러진다.

/** 초점 기준 한쪽으로 온전히 그리는 궤도 수. */
export const ORBIT_RING_SIDE = 1;

/** 그 바깥에 "더 있다"고 알리는 흐린 궤도 수(한쪽). */
export const ORBIT_RING_HINTS = 2;

/** 흐린 궤도 구간의 간격 배율. 바깥으로 갈수록 눌려 붙는다. */
const RING_COMPRESS = 0.2;

/** 초점에서 가장 멀리 그려지는 궤도까지의 거리(간격 단위). */
export const ORBIT_RING_REACH = ORBIT_RING_SIDE + ORBIT_RING_HINTS * RING_COMPRESS;

export interface RingPlacement {
  /**
   * 초점에서 떨어진 거리(간격 단위, 연속값). 반경은 `rFocus + offset * spacing`.
   * 음수면 안쪽(중심에 가깝다), 양수면 바깥이다.
   */
  offset: number;
  /**
   * 온전한 구간을 넘어선 정도(0 ~ ORBIT_RING_HINTS).
   * 0 보다 크면 "밖에 더 있다"를 알리는 흐린 궤도다.
   */
  beyond: number;
}

/**
 * focus 가 초점인 궤도 무리에서 index 번째 궤도가 놓일 자리.
 *
 * focus 는 애니메이션 중간값이라 정수가 아닐 수 있다. 너무 멀어 그리지 않는 궤도는 null.
 */
export function ringPlacement(index: number, focus: number, total: number): RingPlacement | null {
  if (total <= 0 || index < 0 || index >= total) return null;

  const delta = index - focus;
  const distance = Math.abs(delta);
  if (distance > ORBIT_RING_SIDE + ORBIT_RING_HINTS) return null;

  const beyond = Math.max(0, distance - ORBIT_RING_SIDE);
  const magnitude = Math.min(distance, ORBIT_RING_SIDE) + beyond * RING_COMPRESS;

  return { offset: Math.sign(delta) * magnitude, beyond };
}

/** 회전량을 아이템 수 안에서 순환시킨다. 한 바퀴를 넘겨도 제자리로 돌아온다. */
export function normalizeRotation(rotation: number, total: number): number {
  if (total <= 0) return 0;
  return ((rotation % total) + total) % total;
}

/**
 * 링 위에서 from 에서 to 로 가는 **최단 부호 거리**. 결과는 (-total/2, total/2].
 *
 * from 은 애니메이션 중간값이라 정수가 아닐 수 있다.
 */
export function ringDelta(from: number, to: number, total: number): number {
  if (total <= 0) return 0;
  const raw = (((to - from) % total) + total) % total;
  return raw > total / 2 ? raw - total : raw;
}

/**
 * 지금 회전량에서 index 를 최하단으로 가져오는 목표 회전량.
 *
 * 최단 방향으로 돈다 — 마지막 점에서 첫 점으로 넘어가도 한 칸만 돌고
 * 거꾸로 한 바퀴를 되감지 않는다.
 */
export function alignOffset(current: number, index: number, total: number): number {
  return current + ringDelta(current, index, total);
}

/** 이웃한 두 점 사이의 각도. 점이 적으면 넓게 벌려 앞면을 채운다. */
export function orbitGap(total: number): number {
  return ORBIT_ARC_SPAN / Math.max(3, Math.min(total, ORBIT_VISIBLE_COUNT));
}

export interface OrbitPlacement {
  /** 궤도 위 각도(도). 0=왼쪽 끝, 90=최하단, 180=오른쪽 끝. */
  angle: number;
  /**
   * 온전한 구간을 넘어선 정도(0 ~ ORBIT_EDGE_HINTS).
   *
   * 0 이면 온전한 점, 0 보다 크면 "궤도 밖에 더 있다"를 알리는 축소 점이다.
   * 회전이 연속값이라 이 값도 연속이며, 크기·농도를 여기에 비례시키면
   * 온전한 점에서 축소 점으로 끊김 없이 넘어간다.
   */
  beyond: number;
}

/**
 * offset 이 최하단인 궤도에서 index 번째 점이 놓일 자리.
 *
 * 뒤편으로 넘어가 보이지 않는 점은 null.
 */
export function orbitPlacement(
  index: number,
  offset: number,
  total: number,
): OrbitPlacement | null {
  if (total <= 0) return null;

  const delta = ringDelta(offset, index, total);
  const distance = Math.abs(delta);
  if (distance > ORBIT_VISIBLE_SIDE + ORBIT_EDGE_HINTS) return null;

  const gap = orbitGap(total);
  const beyond = Math.max(0, distance - ORBIT_VISIBLE_SIDE);
  const magnitude = Math.min(distance, ORBIT_VISIBLE_SIDE) * gap + beyond * gap * EDGE_COMPRESS;

  return { angle: 90 + Math.sign(delta) * magnitude, beyond };
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
    alias: session.alias ?? null,
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

/**
 * 중심=세션, 궤도=그 세션의 페이지 전부.
 *
 * 페이지 수와 무관하게 **궤도는 하나**다. 앞면에 다 못 놓는 만큼은 뒤편에 있다가 회전으로
 * 올라온다(orbitPlacement). 예전에는 궤도 하나의 정원이 14개라 페이지가 많으면 바깥
 * 궤도로 이어 붙였는데, 그러면 세션 하나가 여러 개로 쪼개져 보인다.
 */
export function buildSessionScene(session: SessionNode): OrbitScene {
  return {
    kind: 'session',
    id: session.id,
    title: session.title,
    meta: `페이지 ${session.pages.length} · ${formatMinutes(session.minutes)} · ${session.date}`,
    hue: session.hue,
    // 페이지가 없으면 궤도도 없다 — 캔버스가 빈 상태 안내를 띄운다.
    tracks:
      session.pages.length === 0
        ? []
        : [
            {
              id: `${session.id}-orbit`,
              // 라벨을 비운다 — 중심 노드 아래 제목과 똑같은 글자가 겹친다.
              label: '',
              hue: session.hue,
              points: session.pages.map(pageToPoint),
              sessionId: null,
              chip: null,
            },
          ],
  };
}

/** 폴더 안 세션을 합친 값. 캔버스 부제와 상세 패널이 같은 수를 쓴다. */
export interface FolderTotals {
  sessionCount: number;
  pageCount: number;
  minutes: number;
}

export function folderTotals(folder: FolderNode): FolderTotals {
  return {
    sessionCount: folder.sessions.length,
    pageCount: folder.sessions.reduce((sum, session) => sum + session.pages.length, 0),
    minutes: folder.sessions.reduce((sum, session) => sum + session.minutes, 0),
  };
}

/** 폴더 전체에서 많이 나온 도메인. 세션 하나가 아니라 폴더의 성격을 보여 준다. */
export function folderTopDomains(folder: FolderNode, limit = 6) {
  const counts = new Map<string, number>();
  folder.sessions.forEach((session) => {
    session.pages.forEach((page) => {
      counts.set(page.domain, (counts.get(page.domain) ?? 0) + 1);
    });
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([domain, count]) => ({ domain, count }));
}

/** 폴더에서 페이지가 가장 많은 세션. 폴더를 대표하는 탐색으로 본다. */
export function largestSession(folder: FolderNode): SessionNode | null {
  return folder.sessions.reduce<SessionNode | null>(
    (top, session) => (!top || session.pages.length > top.pages.length ? session : top),
    null,
  );
}

/** 중심=폴더, 궤도 한 줄=세션 하나, 그 궤도의 점=해당 세션의 페이지. */
export function buildFolderScene(folder: FolderNode): OrbitScene {
  const { sessionCount, pageCount, minutes } = folderTotals(folder);
  return {
    kind: 'folder',
    id: folder.id,
    title: folder.name,
    meta: `세션 ${sessionCount} · 페이지 ${pageCount} · ${formatMinutes(minutes)}`,
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

// ── 네비게이터 정렬 ───────────────────────────────────────────────────

export type SessionSort = 'recent' | 'title';

/**
 * 세션 목록 정렬. 원본을 바꾸지 않는다.
 *
 * `recent` 는 마지막 활동 시각 내림차순 — `buildAtlasSessions` 가 이미 그 순서로
 * 만들어 두므로 여기서는 순서를 유지하기만 한다.
 * `title` 은 화면에 보이는 이름(별칭 반영) 기준 가나다순이다. 사용자가 별칭을 붙였는데
 * 원래 이름으로 정렬되면 목록이 뒤죽박죽으로 보인다.
 */
export function sortSessions(sessions: SessionNode[], sort: SessionSort): SessionNode[] {
  if (sort === 'recent') return sessions;
  return sessions
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title, 'ko', { numeric: true }));
}

// ── 네비게이터 세로 이동(↑↓) ─────────────────────────────────────────

/** 네비게이터에 보이는 세로 한 줄. 세션이 null 이면 폴더 줄이다. */
export interface NavRow {
  /** null 이면 "정리 안 됨" 자리의 세션. */
  folderId: string | null;
  /** null 이면 폴더 줄. */
  sessionId: string | null;
}

/**
 * ↑↓ 가 훑는 세로 순서.
 *
 * 폴더 줄을 차례로 놓고, **지금 보고 있는 폴더의 세션만** 그 아래에 끼운다. 모든 폴더를
 * 펼쳐 이으면 폴더 하나 건너가는 데 그 안의 세션을 전부 지나야 한다. 마지막에 정리 안 된
 * 세션이 붙어, 폴더·폴더 안 세션·미정리 세션이 한 줄로 이어진다.
 */
export function buildNavRows(
  folders: FolderNode[],
  unfiled: SessionNode[],
  openFolderId: string | null,
): NavRow[] {
  const rows: NavRow[] = [];
  folders.forEach((folder) => {
    rows.push({ folderId: folder.id, sessionId: null });
    if (folder.id !== openFolderId) return;
    folder.sessions.forEach((session) =>
      rows.push({ folderId: folder.id, sessionId: session.id }),
    );
  });
  unfiled.forEach((session) => rows.push({ folderId: null, sessionId: session.id }));
  return rows;
}

/**
 * 지금 줄에서 한 칸 옮긴 줄. 더 갈 곳이 없으면 null.
 *
 * 목록 밖으로는 나가지 않는다 — 끝에서 반대편으로 감기면 어디까지 훑었는지 잃는다.
 * 지금 줄이 목록에 없으면(방금 폴더가 지워졌다든지) 방향에 맞는 끝에서 시작한다.
 */
export function stepNavRow(rows: NavRow[], current: NavRow | null, direction: 1 | -1): NavRow | null {
  if (rows.length === 0) return null;

  const index = current
    ? rows.findIndex(
        (row) => row.folderId === current.folderId && row.sessionId === current.sessionId,
      )
    : -1;
  if (index < 0) return direction === 1 ? rows[0] : rows[rows.length - 1];

  const next = Math.min(rows.length - 1, Math.max(0, index + direction));
  return next === index ? null : rows[next];
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
