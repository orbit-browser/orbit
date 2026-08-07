/**
 * 새 탭 홈의 바로가기 — 크롬 기본 새 탭의 그것과 같은 역할.
 *
 * 사용자가 아직 손대지 않았으면 `chrome.topSites`(자주 방문한 사이트)를 보여주고,
 * 한 번이라도 추가·삭제하면 그때부터는 사용자 목록만 쓴다. 크롬 새 탭과 같은 규칙이다.
 *
 * 순수 로직(정규화·병합)은 여기 함수로 분리해 두고, 저장소 접근만 async 로 감쌌다.
 */

import { parseOmniboxInput } from '../../../lib/omnibox';

export interface Shortcut {
  id: string;
  title: string;
  url: string;
}

/** 크롬 새 탭과 같은 상한. 한 줄에 담기는 개수를 넘기지 않는다. */
export const MAX_SHORTCUTS = 10;

const STORAGE_KEY = 'newtab.shortcuts';
const OPEN_KEY = 'newtab.shortcutsOpen';

/** 같은 사이트를 두 번 담지 않도록 비교에 쓰는 키. 프로토콜과 끝 슬래시는 무시한다. */
export function shortcutKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname.replace(/\/$/, '')}${parsed.search}`;
  } catch {
    return url;
  }
}

/**
 * 사용자가 입력한 이름·주소를 바로가기로 정규화한다.
 * 주소로 해석되지 않으면(검색어처럼 보이면) 거부한다 — 바로가기는 반드시 주소여야 한다.
 */
export function normalizeShortcutInput(
  title: string,
  url: string,
): { ok: true; shortcut: Omit<Shortcut, 'id'> } | { ok: false; reason: string } {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) return { ok: false, reason: '주소를 입력해 주세요.' };

  const intent = parseOmniboxInput(trimmedUrl);
  if (intent.kind !== 'navigate') {
    return { ok: false, reason: '주소 형식이 아니에요. 예: github.com' };
  }

  const trimmedTitle = title.trim();
  return {
    ok: true,
    shortcut: {
      // 이름을 비우면 호스트명을 쓴다 — 크롬 새 탭과 같은 폴백.
      title: trimmedTitle || hostLabel(intent.url),
      url: intent.url,
    },
  };
}

function hostLabel(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** topSites 응답을 바로가기 목록으로 바꾼다. 제목이 빈 항목은 호스트명으로 채운다. */
export function fromTopSites(sites: { title: string; url: string }[]): Shortcut[] {
  const seen = new Set<string>();
  const out: Shortcut[] = [];
  for (const site of sites) {
    const key = shortcutKey(site.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: `top:${key}`, title: site.title?.trim() || hostLabel(site.url), url: site.url });
    if (out.length >= MAX_SHORTCUTS) break;
  }
  return out;
}

/** 목록에 하나를 더한다. 이미 있는 주소면 그대로 둔다. 상한을 넘기면 거부한다. */
export function appendShortcut(
  list: Shortcut[],
  next: Omit<Shortcut, 'id'>,
): { ok: true; list: Shortcut[] } | { ok: false; reason: string } {
  const key = shortcutKey(next.url);
  if (list.some((s) => shortcutKey(s.url) === key)) {
    return { ok: false, reason: '이미 있는 바로가기예요.' };
  }
  if (list.length >= MAX_SHORTCUTS) {
    return { ok: false, reason: `바로가기는 ${MAX_SHORTCUTS}개까지 추가할 수 있어요.` };
  }
  return { ok: true, list: [...list, { ...next, id: `user:${key}:${Date.now()}` }] };
}

// ── 저장소 ────────────────────────────────────────────────────────────────

export interface LoadedShortcuts {
  list: Shortcut[];
  customized: boolean;
  /** 읽기에 실패했을 때 사용자에게 보여줄 문구. 성공이면 null. */
  error: string | null;
}

/**
 * 보여줄 바로가기를 읽는다.
 * 사용자가 편집한 적이 있으면 그 목록을, 없으면 topSites 를 쓴다.
 *
 * 어느 쪽이 실패하든 화면이 로딩 상태에 갇히지 않도록 항상 목록을 돌려주고,
 * 실패 사실은 `error` 로 함께 넘긴다 — 조용히 빈 화면으로 두지 않는다.
 */
export async function loadShortcuts(): Promise<LoadedShortcuts> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const saved = stored[STORAGE_KEY] as Shortcut[] | undefined;
    if (Array.isArray(saved)) return { list: saved, customized: true, error: null };
  } catch (err) {
    console.error('[Orbit] 바로가기 불러오기 실패', err);
    return { list: [], customized: false, error: '바로가기를 불러오지 못했어요.' };
  }

  try {
    const sites = await chrome.topSites.get();
    return { list: fromTopSites(sites), customized: false, error: null };
  } catch (err) {
    // 권한이 없거나 API 가 막힌 경우. 직접 추가는 계속 쓸 수 있으므로 목록만 비운다.
    console.error('[Orbit] topSites 조회 실패', err);
    return {
      list: [],
      customized: false,
      error: '자주 방문한 사이트를 불러오지 못했어요. 직접 추가할 수 있어요.',
    };
  }
}

/** 저장 실패는 사용자에게 알린다. 실패를 삼키면 다음에 열었을 때 편집이 사라져 보인다. */
export async function saveShortcuts(list: Shortcut[]): Promise<string | null> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: list });
    return null;
  } catch (err) {
    console.error('[Orbit] 바로가기 저장 실패', err);
    return '바로가기를 저장하지 못했어요.';
  }
}

export async function loadShortcutsOpen(): Promise<boolean> {
  try {
    const stored = await chrome.storage.local.get(OPEN_KEY);
    const value = stored[OPEN_KEY];
    return typeof value === 'boolean' ? value : true;
  } catch {
    return true;
  }
}

export async function saveShortcutsOpen(open: boolean): Promise<void> {
  try {
    await chrome.storage.local.set({ [OPEN_KEY]: open });
  } catch (err) {
    console.error('[Orbit] 바로가기 펼침 상태 저장 실패', err);
  }
}

/** 확장 내장 파비콘 — 외부 서비스에 방문 기록을 흘리지 않는다. `favicon` 권한 필요. */
export function faviconUrl(url: string, size = 64): string {
  try {
    const target = new URL(chrome.runtime.getURL('/_favicon/'));
    target.searchParams.set('pageUrl', url);
    target.searchParams.set('size', String(size));
    return target.toString();
  } catch {
    // 확장 컨텍스트 밖(테스트·미리보기)에서는 파비콘을 못 만든다. 타일만 비워 둔다.
    return '';
  }
}
