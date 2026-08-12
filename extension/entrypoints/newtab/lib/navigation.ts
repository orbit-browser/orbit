/**
 * orbit_front 시안의 `src/lib/navigation.ts` 를 옮긴 파일.
 *
 * 시안은 경로(`/orbit-atlas`)로 라우팅했지만, 확장 페이지의 URL은
 * `chrome-extension://<id>/newtab.html` 이라 pushState 로 경로를 바꾸면
 * 새로고침 시 존재하지 않는 파일을 찾게 된다. 해시 라우팅으로 바꿔
 * 새로고침·뒤로가기에도 같은 화면이 뜨도록 했다. 그 외 동작은 시안과 같다.
 */

export type AppRoute = 'home' | 'orbit-atlas';

/** 메인 드로어에서 고른 항목을 아틀라스로 넘길 때 쓰는 선택 정보 */
export interface AtlasTarget {
  orbitId?: string;
  sessionId?: string;
  pageId?: string;
}

const ATLAS_HASH = '#/orbit-atlas';

/** `#/orbit-atlas?orbit=...` 에서 경로부와 쿼리부를 나눈다. */
function splitHash(): { path: string; query: string } {
  const raw = window.location.hash.replace(/^#/, '');
  const [path, query = ''] = raw.split('?');
  return { path, query };
}

export function getRoute(): AppRoute {
  return splitHash().path === '/orbit-atlas' ? 'orbit-atlas' : 'home';
}

export function navigate(hash: string) {
  window.history.pushState({}, '', hash);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function navigateToRoute(route: AppRoute) {
  navigate(route === 'orbit-atlas' ? ATLAS_HASH : '#/');
}

/**
 * 아틀라스를 특정 선택 상태로 연다.
 * 선택을 URL 에 실어서 새로고침에도 같은 화면이 뜨도록 한다.
 */
export function navigateToAtlas(target: AtlasTarget = {}) {
  const params = new URLSearchParams();
  if (target.orbitId) params.set('orbit', target.orbitId);
  if (target.sessionId) params.set('session', target.sessionId);
  if (target.pageId) params.set('page', target.pageId);
  const qs = params.toString();
  navigate(`${ATLAS_HASH}${qs ? `?${qs}` : ''}`);
}

/**
 * 온보딩 안내 탭(`newtab.html?onboarding=1`)을 대시보드로 바꾼다.
 *
 * 해시만 바꾸면 `onboarding=1` 쿼리가 남아 안내 화면이 계속 렌더되므로 쿼리까지 지운다.
 * 뒤로가기로 끝난 안내 화면에 돌아갈 이유가 없어 pushState 가 아니라 replaceState 다.
 */
export function replaceWithAtlas() {
  window.history.replaceState({}, '', `${window.location.pathname}${ATLAS_HASH}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function readAtlasTarget(): AtlasTarget {
  const params = new URLSearchParams(splitHash().query);
  return {
    orbitId: params.get('orbit') ?? undefined,
    sessionId: params.get('session') ?? undefined,
    pageId: params.get('page') ?? undefined,
  };
}
