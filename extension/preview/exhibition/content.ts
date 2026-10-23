/**
 * 현수막에 들어가는 내용 — 미리보기 합성 데이터(preview/fixtures.ts)에서 만든다.
 * 실제 사용자의 방문 기록은 쓰지 않는다. 카드 속 페이지 화면은 공개 웹페이지 캡처다(capture-shots.mjs).
 * 성능 숫자는 여기 두지 않는다(metrics.json).
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
 * CHAOS 가 "어제 봤던 그 페이지"라서, ORBIT 에서 꺼내 보이는 제주 세션도 '어제'가 되게 시계를 옮긴다.
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
 * ORBIT 갤러리에서 오갈 수 있는 세션 — 인쇄할 수 있는 페이지(printable)가 셋 이상인 것만. 폴더끼리 붙여 둔다(막대가
 * 아틀라스처럼 같은 폴더의 세션을 위아래 줄로 보여 준다). 첫 번째가 인쇄되는 세션이다.
 */
export const GALLERY_SESSION_IDS = ['s-jeju', 's-mv3', 's-qdrant'];

// ── 페이지 화면 ─────────────────────────────────────────────────────

/**
 * 인쇄물에 남의 사이트 화면이 들어가므로 쓸 화면을 고른다(보고서에 목록을 남긴다). 기준은 "카드에 보이는 자리에
 * 있는가"다 — 흐린 뒤쪽 카드도 실제 크기로는 수십 cm 다. 여기 있는 페이지는 화면을 그리지 않고, 갤러리·팀 카드·
 * CHAOS 에서 아예 쓰지 않는다(printable).
 */
export const EXCLUDED_SHOTS = new Set([
  // 사람 얼굴이 크게 보이는 영상·광고
  'https://quasarzone.com/bbs/qc_qsz',
  'https://www.youtube.com/watch?v=5070noise',
  'https://www.youtube.com/watch?v=toss-template',
  // 동의 팝업, 제품 사진 위주의 브랜드 페이지, 광고
  'https://www.nike.com/kr/t/pegasus-42',
  'https://www.apple.com/kr/airpods-pro/',
  'https://www.hankyung.com/article/2026091512',
  // 남의 작품(디자인 모음, 작가 글의 표지, 글쓴이가 만든 썸네일 그림)
  'https://www.behance.net/search/projects/product%20demo',
  'https://dribbble.com/search/pitch-deck',
  'https://www.figma.com/community/presentation-templates',
  'https://brunch.co.kr/@techtalk/42',
  'https://velog.io/@react/react19',
  'https://velog.io/@nlp/summary-metrics',
  // 홍보 배너·할인 팝업·혜택 띠가 보이는 자리에 있다
  'https://www.molit.go.kr/jeonse',
  'https://carmore.kr/home/',
  'https://subway.city.fukuoka.lg.jp/route/',
  // 블로그 검색 결과의 썸네일이 "특가 할인" 광고 그림이다
  'https://blog.naver.com/runner/2231',
  // "광고" 표시가 붙은 상품 줄, 할인율·쿠폰 딱지
  'https://prod.danawa.com/list/?cate=112753',
  'https://search.danawa.com/dsearch.php?query=에어팟프로3',
  'https://www.compuzone.co.kr/search/search.htm?SearchProductKey=5070',
  'https://www.musinsa.com/category/103004',
  // 문서 위 띠·옆 칸의 후원사 광고(암호화폐 결제, 코드 리뷰 도구, 후원사 로고, API 도구, 강의 할인)
  'https://fastapi.tiangolo.com/tutorial/dependencies/dependencies-with-yield/',
  'https://fastapi.tiangolo.com/tutorial/background-tasks/',
  'https://fastapi.tiangolo.com/advanced/custom-response/#streamingresponse',
  'https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates',
  'https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html',
  'https://www.promptingguide.ai/techniques',
  // 덜 그려진 화면
  'https://velog.io/@web/fetch-stream-abort',
  'https://stackoverflow.com/questions/66618136',
  // 헤드리스를 막아 화면이 없다(capture-shots.mjs BLOCKED)
  'https://stackoverflow.com/questions/72921178',
  'https://tabelog.com/osaka/rstLst/',
]);

/** 인쇄에 쓰는 페이지 — 화면을 뺀 페이지는 갤러리·팀 카드·CHAOS 에 두지 않는다(회색 칸을 남기지 않는다). */
export const printable = (page: ExhibitPage): boolean => !EXCLUDED_SHOTS.has(page.url);

/** 갤러리·막대에 보이는 세션 — 인쇄할 수 있는 페이지만. 타임라인은 원래 세션의 모든 방문을 보인다. */
export const shownSession = (id: string): ExhibitSession => {
  const session = sessionById(id);
  return { ...session, pages: session.pages.filter(printable) };
};

/**
 * 화면의 한 부분만 쓰는 페이지 — 위쪽 혜택 카드, 오른쪽 혜택 칸, 지도 위 안내 말풍선을 피해 깨끗한 부분을 키워 보인다.
 * 값은 1000px 폭 캡처의 CSS px(x, y, 폭). 카드는 고른 폭의 최대 1.17배 높이(CHAOS 세로 카드)까지 보이므로
 * 그 높이까지 깨끗한 자리로 잡았다(2026-10-22 캡처에서 잼).
 */
export const SHOT_FOCUS: Record<string, { x: number; y: number; w: number }> = {
  // 네이버 항공권 첫 화면: 검색 상자까지(y 652 부터 혜택 카드, 왼쪽 위 '여행핫딜' 메뉴와 오른쪽 위 쿠폰 표시는 밖)
  'https://flight.naver.com/flights/domestic/GMP-CJU': { x: 226, y: 0, w: 547 },
  // 야놀자 숙소 상세: 사진·이름·평점·후기(x 918 부터 로그인 혜택 칸, y 1010 부터 숙소 이벤트)
  'https://www.yanolja.com/search/서귀포': { x: 0, y: 0, w: 840 },
  // 다이닝코드: 왼쪽 목록(x 462 부터 지도 위 안내 말풍선, y 690 에 빈 광고 자리)
  'https://www.diningcode.com/list.dc?query=애월카페': { x: 0, y: 0, w: 440 },
};

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

export const shotFor = (url: string): string | null => shots[url] ?? null;

/** 미리보기 서버의 파비콘 대역(vite.config.ts). 확장의 `_favicon/` 과 같이 출처 단위로 묻는다. */
export function faviconFor(url: string): string {
  try {
    return `/_favicon?pageUrl=${encodeURIComponent(`${new URL(url).origin}/`)}`;
  } catch {
    return '';
  }
}

/** CHAOS 에 흩어지는 페이지 — 합성 데이터의 모든 방문(제주 세션 포함, ORBIT 에서 다시 만난다). */
export const ALL_PAGES: ExhibitPage[] = db.sessions.flatMap((session) => session.events.map(toPage));
export const pageByUrl = (url: string): ExhibitPage | undefined => ALL_PAGES.find((page) => page.url === url);
