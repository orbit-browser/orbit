import type { OpenTabItem } from './types';

const BOOKMARKABLE_PROTOCOLS = new Set(['http:', 'https:', 'file:']);

export interface OpenTabNavigationIntent {
  kind: 'navigate-open-tab';
  target: string;
}

export interface OpenTabMatch {
  tab: OpenTabItem;
  matchCount: number;
  candidates: OpenTabItem[];
}

const NAVIGATION_ACTION = /(?:이동|전환|열어|띄워)(?:\s*해)?\s*(?:줘|주세요|줄래|주시겠어)?\s*$/;
const OPEN_TABS_PREFIX = /^(?:(?:지금|현재)\s*)?(?:(?:떠\s*있는|열려\s*있는|열린)\s*)?탭(?:들)?\s*중(?:에|에서)?\s*/;
const OPEN_STATE_PREFIX = /^(?:(?:지금|현재)\s*)?(?:떠\s*있는|열려\s*있는|열린)\s*/;
const TIME_PREFIX = /^(?:지금|현재)\s*/;
const TARGET_TAB_SUFFIX = /\s*(?:(?:이|그|저)\s*)?탭(?:들)?(?:으로|로|을|를)?\s*$/;
const FIND_SUFFIX = /\s*(?:찾아(?:서)?|검색(?:해서)?)\s*$/;
const DEICTIC_TARGETS = new Set(['이', '그', '저', '이거', '그거', '저거']);
const NAVIGATION_CUES = [
  /(?:이동|전환)(?:해|시켜)?\s*(?:줘|주세요|줄래|하자)?/,
  /(?:로|으로|데로|곳으로)\s*(?:가\s*줘|가자|돌아가|돌아와|돌아오)/,
  /(?:열어|띄워)\s*(?:줘|주세요|줄래)/,
  /(?:아까|방금|보던|하던|작성하던|확인하던).*(?:가\s*줘|가자|돌아가|돌아와|열어|띄워|계속|이어서)/,
  /(?:열려\s*있는|떠\s*있는|열린).*(?:어디|찾아\s*줘|찾아\s*주세요)/,
  /\b(?:switch|go back|return to|take me to|open the)\b/i,
];
const TARGET_ALIASES: Record<string, readonly string[]> = {
  유튜브: ['youtube', 'youtube.com'],
  깃허브: ['github', 'github.com'],
  노션: ['notion', 'notion.so'],
  지메일: ['gmail', 'mail.google.com'],
  구글: ['google', 'google.com'],
  네이버: ['naver', 'naver.com'],
  슬랙: ['slack', 'slack.com'],
  피그마: ['figma', 'figma.com'],
  넷플릭스: ['netflix', 'netflix.com'],
  인스타그램: ['instagram', 'instagram.com'],
  페이스북: ['facebook', 'facebook.com'],
  트위터: ['x.com', 'twitter.com'],
  챗지피티: ['chatgpt', 'chatgpt.com', 'chat.openai.com'],
};

function normalize(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase();
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function targetVariants(rawTarget: string): string[] {
  const target = normalize(rawTarget);
  return [...new Set([target, ...(TARGET_ALIASES[target] ?? [])])];
}

function tabMatchScoreForTarget(tab: OpenTabItem, target: string): number {
  const title = normalize(tab.title);
  const url = normalize(tab.url);
  const host = normalize(hostname(tab.url));

  if (title === target) return 1_000;
  if (host === target) return 950;
  if (title.startsWith(target)) return 850;
  if (host.startsWith(target)) return 800;
  if (title.includes(target)) return 700;
  if (host.includes(target)) return 650;
  if (url.includes(target)) return 500;

  const tokens = target.split(/\s+/).filter(Boolean);
  const searchable = `${title}\n${host}\n${url}`;
  return tokens.length > 1 && tokens.every((token) => searchable.includes(token))
    ? 300 + tokens.length
    : 0;
}

function tabMatchScore(tab: OpenTabItem, rawTarget: string): number {
  return Math.max(...targetVariants(rawTarget).map((target) => tabMatchScoreForTarget(tab, target)));
}

export function parseOpenTabNavigationIntent(rawQuery: string): OpenTabNavigationIntent | null {
  const query = rawQuery.trim().replace(/[.!?]+$/g, '').replace(/\s+/g, ' ');
  if (!query.includes('탭') || !NAVIGATION_ACTION.test(query)) return null;

  let target = query.replace(NAVIGATION_ACTION, '').trim();
  target = target.replace(OPEN_TABS_PREFIX, '').trim();

  // “유튜브 탭 찾아서”, “유튜브 찾아서 그 탭으로”처럼 보조 표현의 순서가 달라도 제거한다.
  for (let pass = 0; pass < 3; pass += 1) {
    target = target.replace(TARGET_TAB_SUFFIX, '').replace(FIND_SUFFIX, '').trim();
  }

  target = target
    .replace(OPEN_STATE_PREFIX, '')
    .replace(TIME_PREFIX, '')
    .replace(/^(?:['“”‘’]|\s)+|(?:['“”‘’]|\s)+$/g, '')
    .replace(/(?:으로|로|을|를)$/g, '')
    .trim();

  if (DEICTIC_TARGETS.has(target)) target = '';
  return { kind: 'navigate-open-tab', target };
}

export function mayBeOpenTabNavigation(rawQuery: string): boolean {
  const query = rawQuery.normalize('NFKC').trim();
  return query.length > 0 && NAVIGATION_CUES.some((pattern) => pattern.test(query));
}

export function findBestOpenTab(tabs: OpenTabItem[], target: string): OpenTabMatch | null {
  if (!normalize(target)) return null;
  const matches = tabs
    .map((tab) => ({ tab, score: tabMatchScore(tab, target) }))
    .filter((match) => match.score > 0)
    .sort((left, right) =>
      right.score - left.score ||
      Number(right.tab.active) - Number(left.tab.active) ||
      left.tab.windowId - right.tab.windowId ||
      left.tab.index - right.tab.index,
    );

  if (matches.length === 0) return null;
  return {
    tab: matches[0].tab,
    matchCount: matches.length,
    candidates: matches.map((match) => match.tab),
  };
}

export function isBookmarkableUrl(url: string): boolean {
  try {
    return BOOKMARKABLE_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

export function filterOpenTabs(tabs: OpenTabItem[], rawQuery: string): OpenTabItem[] {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return tabs;
  return tabs.filter((tab) =>
    `${tab.title}\n${tab.url}`.toLocaleLowerCase().includes(query),
  );
}

export function openTabLocationLabel(rawUrl: string): string {
  if (!rawUrl) return '주소 없음';

  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'file:') return '로컬 파일';
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.hostname.replace(/^www\./, '') || rawUrl;
    }
    if (url.hostname) return `${url.protocol}//${url.hostname}`;
    return rawUrl;
  } catch {
    return rawUrl;
  }
}

export function uniqueBookmarkTabs(tabs: OpenTabItem[]): {
  tabs: OpenTabItem[];
  skippedCount: number;
} {
  const seenUrls = new Set<string>();
  const unique: OpenTabItem[] = [];
  let skippedCount = 0;

  for (const tab of tabs) {
    if (!tab.bookmarkable || seenUrls.has(tab.url)) {
      skippedCount += 1;
      continue;
    }
    seenUrls.add(tab.url);
    unique.push(tab);
  }

  return { tabs: unique, skippedCount };
}
