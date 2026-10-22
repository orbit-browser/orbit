/**
 * 현수막에 들어가는 세션과 페이지 — 가상 데모 데이터(demo.ts)에서 만든다.
 * 실제 사용자의 방문 기록도, 실존 사이트의 화면도 쓰지 않는다. 성능 숫자는 여기 두지 않는다(metrics.json).
 */
import { hueForSession } from '../../lib/session-hue';
import { DEMO_SESSIONS, SITES, type DemoPage, type Site } from './demo';

export interface ExhibitPage extends DemoPage {
  domain: string;
  url: string;
  /** 시연용 시각(HH:MM) */
  time: string;
}

export interface ExhibitSession {
  id: string;
  title: string;
  hue: string;
  folder: string | null;
  day: string;
  minutes: number;
  overview: string;
  highlights: string[];
  next: string[];
  pages: ExhibitPage[];
}

const toMinutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
const toClock = (minutes: number) => {
  const value = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
};

export const SESSIONS: ExhibitSession[] = DEMO_SESSIONS.map((session) => {
  // 마지막 페이지가 end 에 끝나도록 체류 시간만큼 거꾸로 센다(사이 1분) — fixtures 와 같은 방식
  let cursor = toMinutes(session.end);
  const times: string[] = [];
  for (let index = session.pages.length - 1; index >= 0; index -= 1) {
    cursor -= session.pages[index].minutes;
    times[index] = toClock(cursor);
    cursor -= 1;
  }
  return {
    id: session.id,
    title: session.title,
    hue: hueForSession(session.id),
    folder: session.folder,
    day: session.day,
    minutes: session.pages.reduce((sum, page) => sum + page.minutes, 0),
    overview: session.overview,
    highlights: session.highlights,
    next: session.next,
    pages: session.pages.map((page, index) => {
      const site: Site = SITES[page.site];
      return { ...page, domain: site.domain, url: `https://${site.domain}${page.path}`, time: times[index] };
    }),
  };
});

export const sessionById = (id: string): ExhibitSession => SESSIONS.find((session) => session.id === id)!;
export const siteOf = (page: ExhibitPage): Site => SITES[page.site];

/**
 * 2번 현수막 갤러리에서 오갈 수 있는 세션(페이지 셋 이상). 폴더끼리 붙여 둔다 — 막대가 아틀라스처럼
 * 같은 폴더의 세션을 위아래 줄로 보여 준다. 첫 번째가 인쇄되는 세션이다.
 */
export const GALLERY_SESSION_IDS = SESSIONS.filter((session) => session.pages.length >= 3)
  .sort((a, b) => folderOrder(a.folder) - folderOrder(b.folder))
  .map((session) => session.id);

function folderOrder(folder: string | null): number {
  const order = ['여행', '졸업 프로젝트', '쇼핑'];
  const index = folder ? order.indexOf(folder) : -1;
  return index < 0 ? order.length : index;
}

/** 1번 현수막에 흩어지는 모든 페이지(제주 세션 포함, 2번에서 다시 만난다). */
export const ALL_PAGES: ExhibitPage[] = SESSIONS.flatMap((session) => session.pages);
export const pageById = (id: string): ExhibitPage | undefined => ALL_PAGES.find((page) => page.id === id);
