/**
 * 현수막에 들어가는 내용 — 미리보기 합성 데이터(preview/fixtures.ts)에서 만든다.
 * 실제 사용자의 방문 기록은 쓰지 않는다. 성능 숫자는 여기 두지 않는다(metrics.json).
 */
import { hueForSession } from '../../lib/session-hue';
import { createPreviewDb, type PreviewEvent } from '../fixtures';

export interface ExhibitPage {
  id: string;
  title: string;
  url: string;
  domain: string;
  /** 체류 시간(분). */
  minutes: number;
  /** 시연용 시각(HH:MM). */
  time: string;
}

export interface ExhibitSession {
  id: string;
  title: string;
  hue: string;
  folder: string | null;
  /** '어제', '3일 전' 같은 상대 날짜. */
  day: string;
  minutes: number;
  overview: string;
  highlights: string[];
  next: string[];
  pages: ExhibitPage[];
}

const db = createPreviewDb();
const HOUR = 3_600_000;

/**
 * 1번 현수막이 "어제 봤던 그 페이지"라서, 2번에서 꺼내 보이는 제주 세션도 '어제'가 되게 시계를 옮긴다.
 * 합성 데이터의 세션 사이 간격은 그대로 둔다.
 */
const DAY_SHIFT_HOURS = 22;
/** 제주 세션의 마지막 방문 시각(분 단위, 15:20). 다른 세션의 시각도 이 기준에서 거꾸로 센다. */
const ANCHOR_MINUTES = 15 * 60 + 20;

const anchor = Date.parse(db.sessions.find((session) => session.session_id === 's-jeju')!.last_activity_at);

function clock(iso: string): string {
  const minutes = (((ANCHOR_MINUTES - Math.round((anchor - Date.parse(iso)) / 60_000)) % 1440) + 1440) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function relativeDay(iso: string): string {
  const days = Math.floor(((Date.now() - Date.parse(iso)) / HOUR + DAY_SHIFT_HOURS) / 24);
  if (days <= 0) return '오늘';
  if (days === 1) return '어제';
  return `${days}일 전`;
}

const folderNames = new Map(db.folders.map((folder) => [folder.folder_id, folder.name]));

const toPage = (event: PreviewEvent): ExhibitPage => ({
  id: event.event_id,
  title: event.title,
  url: event.url,
  domain: event.domain,
  minutes: Math.round(event.active_duration_ms / 60_000),
  time: clock(event.visited_at),
});

/** 내 기록(개인)의 세션 — 팀원 세션은 팀 화면에서만 보이므로 뺀다. */
const mine = db.sessions.filter((session) => session.owner === db.me);

export const SESSIONS: ExhibitSession[] = mine
  .filter((session) => session.summary_status === 'done')
  .map((session) => ({
    id: session.session_id,
    title: session.title,
    hue: hueForSession(session.session_id),
    folder: session.folder_id ? folderNames.get(session.folder_id) ?? null : null,
    day: relativeDay(session.last_activity_at),
    minutes: Math.round(session.events.reduce((sum, event) => sum + event.active_duration_ms, 0) / 60_000),
    overview: session.summary.overview,
    highlights: session.summary.highlights,
    next: session.summary.next_actions,
    pages: session.events.map(toPage),
  }));

export const sessionById = (id: string): ExhibitSession => SESSIONS.find((session) => session.id === id)!;

/**
 * 2번 현수막 갤러리에서 오갈 수 있는 세션(페이지 셋 이상). 폴더끼리 붙여 둔다 — 막대가 아틀라스처럼
 * 같은 폴더의 세션을 위아래 줄로 보여 준다. 첫 번째가 인쇄되는 세션이다.
 */
export const GALLERY_SESSION_IDS = ['s-jeju', 's-osaka', 's-fastapi', 's-mv3', 's-qdrant', 's-slides', 's-gpu', 's-react'];

/** 네비게이터 조각에 보이는 폴더(아틀라스 왼쪽과 같은 순서). */
export const FOLDERS = [...db.folders]
  .sort((a, b) => a.position - b.position)
  .map((folder) => ({
    name: folder.name,
    hue: folder.hue,
    sessions: SESSIONS.filter((session) => session.folder === folder.name),
  }));
export const UNFILED = SESSIONS.filter((session) => session.folder === null);

// ── 페이지 화면 ─────────────────────────────────────────────────────

/**
 * 인쇄물에 남의 사이트 화면이 들어가므로 쓸 화면을 골라 둔다(보고서에 목록을 남긴다).
 * 뺀 것: 사람 얼굴이 크게 보이는 영상·광고 화면, 동의 팝업만 찍힌 화면, 덜 그려진 화면, 제품 사진 위주의 브랜드 페이지,
 * 홍보 문구가 크게 찍힌 화면.
 */
export const EXCLUDED_SHOTS = new Set([
  'https://quasarzone.com/bbs/qc_qsz',
  'https://www.youtube.com/watch?v=5070noise',
  'https://www.youtube.com/watch?v=toss-template',
  'https://www.nike.com/kr/t/pegasus-42',
  'https://www.behance.net/search/projects/product%20demo',
  'https://dribbble.com/search/pitch-deck',
  'https://www.hankyung.com/article/2026091512',
  'https://www.apple.com/kr/airpods-pro/',
  'https://fastapi.tiangolo.com/advanced/custom-response/#streamingresponse',
  'https://velog.io/@web/fetch-stream-abort',
  'https://stackoverflow.com/questions/66618136',
  'https://www.figma.com/community/presentation-templates',
  // 정부 홍보 배너가 크게 찍혀 전시물에서 홍보 문구로 읽힌다
  'https://www.molit.go.kr/jeonse',
]);

let shots: Record<string, string> = {};

/** capture-shots.mjs 가 찍은 화면 목록을 읽는다. 없으면 카드가 자리표시로 그린다. */
export async function loadShots(): Promise<void> {
  const index = (await fetch(new URL('../shots/index.json', location.href))
    .then((response) => (response.ok ? response.json() : {}))
    .catch(() => ({}))) as Record<string, string>;
  shots = Object.fromEntries(
    Object.entries(index)
      .filter(([url]) => !EXCLUDED_SHOTS.has(url))
      .map(([url, path]) => [url, new URL(`../${path}`, location.href).href]),
  );
}

/** 남의 사이트 화면을 빼고 볼 때(대표 판단용) — 끄면 모든 카드가 자리표시로 그린다. */
let showShots = true;
export const setShotsVisible = (visible: boolean) => {
  showShots = visible;
};
export const shotFor = (url: string): string | null => (showShots ? shots[url] ?? null : null);

/** 미리보기 서버의 파비콘 대역(vite.config.ts). 확장의 `_favicon/` 과 같이 출처 단위로 묻는다. */
export function faviconFor(url: string): string {
  try {
    return `/_favicon?pageUrl=${encodeURIComponent(`${new URL(url).origin}/`)}`;
  } catch {
    return '';
  }
}

/** 1번 현수막에 흩어지는 페이지 — 내 모든 방문(제주 세션 포함, 2번에서 다시 만난다). */
export const ALL_PAGES: ExhibitPage[] = mine.flatMap((session) => session.events.map(toPage));
export const pageByUrl = (url: string): ExhibitPage | undefined => ALL_PAGES.find((page) => page.url === url);
