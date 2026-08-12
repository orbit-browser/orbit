import { useCallback, useState } from 'react';
import type { SessionSort } from '../components/atlas/data';

/**
 * 메인 · 아틀라스가 공유하는 네비게이터 상태.
 *
 * 두 화면은 동시에 떠 있지 않으므로 모듈 스코프 값 하나면 충분하다.
 * 라우트가 바뀌어도 열림 여부 · 너비 · 펼침 · 선택 · 검색이 그대로 이어져,
 * 네비게이터는 그대로 있고 오른쪽 내용만 바뀌는 것처럼 보인다.
 */
export interface NavState {
  open: boolean;
  width: number;
  query: string;
  searchOpen: boolean;
  /** 펼쳐 놓은 폴더. */
  expandedOrbitIds: Set<string>;
  expandedSessionIds: Set<string>;
  /** 캔버스 중심에 놓인 세션. 폴더를 보고 있으면 null. */
  focusedOrbitId: string | null;
  /** 캔버스 중심에 놓인 폴더. 값이 있으면 폴더 씬이 우선한다. */
  focusedFolderId: string | null;
  selectedSessionId: string | null;
  selectedPageId: string | null;
  /** 세션 목록 정렬. 폴더 순서는 사용자가 만든 position 을 그대로 둔다. */
  sessionSort: SessionSort;
}

export const NAV_DEFAULT_WIDTH = 288;

let state: NavState = {
  // 새 탭은 닫힌 상태로 시작한다 — 탭을 열 때마다 드로어가 펼쳐져 있으면
  // 브라우저 시작 화면으로서 방해가 된다. 토글하면 그 탭 안에서는 유지된다.
  open: false,
  width: NAV_DEFAULT_WIDTH,
  query: '',
  searchOpen: false,
  expandedOrbitIds: new Set(),
  expandedSessionIds: new Set(),
  focusedOrbitId: null,
  focusedFolderId: null,
  selectedSessionId: null,
  selectedPageId: null,
  sessionSort: 'recent',
};

export function getNavState(): NavState {
  return state;
}

export function patchNavState(patch: Partial<NavState>) {
  state = { ...state, ...patch };
}

/**
 * 공유 상태를 React 상태로 미러링한다.
 * setter 는 로컬 리렌더와 모듈 스토어를 함께 갱신한다.
 */
export function useSharedNavState() {
  const [local, setLocal] = useState<NavState>(getNavState);

  const patch = useCallback((next: Partial<NavState>) => {
    patchNavState(next);
    setLocal(getNavState());
  }, []);

  const toggleIn = useCallback(
    (key: 'expandedOrbitIds' | 'expandedSessionIds', id: string) => {
      const set = new Set(getNavState()[key]);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      patch({ [key]: set } as Partial<NavState>);
    },
    [patch]
  );

  const expandIn = useCallback(
    (key: 'expandedOrbitIds' | 'expandedSessionIds', id: string) => {
      const set = new Set(getNavState()[key]);
      set.add(id);
      patch({ [key]: set } as Partial<NavState>);
    },
    [patch]
  );

  return { nav: local, patch, toggleIn, expandIn };
}
