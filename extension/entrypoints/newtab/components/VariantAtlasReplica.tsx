import { useCallback, useEffect, useMemo, useRef } from 'react';
import '../styles/atlas.css';
import { ATLAS_ORBITS } from './atlas/data';
import { AtlasHeader } from './atlas/AtlasHeader';
import { AtlasNavigator } from './atlas/AtlasNavigator';
import { AtlasCanvas } from './atlas/AtlasCanvas';
import { AtlasTray } from './atlas/AtlasTray';
import { AtlasDetail } from './atlas/AtlasDetail';
import { readAtlasTarget } from '../lib/navigation';
import { getNavState, patchNavState, useSharedNavState } from '../lib/nav-state';

const cx = (...classes: (string | false | undefined | null)[]) => classes.filter(Boolean).join(' ');

/** 트레이가 열렸을 때 캔버스 하단이 가려지는 높이 */
const TRAY_INSET = 250;

/**
 * URL 쿼리(?orbit=&session=&page=)가 있으면 그 선택을,
 * 없으면 공유 네비게이터 상태에 남아 있던 선택을 이어받는다.
 */
function resolveInitialSelection() {
  const target = readAtlasTarget();
  const shared = getNavState();
  const hasTarget = Boolean(target.orbitId || target.sessionId || target.pageId);

  if (!hasTarget && shared.focusedOrbitId) {
    return {
      orbitId: shared.focusedOrbitId,
      sessionId: shared.selectedSessionId,
      pageId: shared.selectedPageId,
    };
  }

  const orbit = target.sessionId
    ? ATLAS_ORBITS.find((o) => o.sessions.some((s) => s.id === target.sessionId))
    : ATLAS_ORBITS.find((o) => o.id === target.orbitId);
  const session = orbit?.sessions.find((s) => s.id === target.sessionId) ?? null;
  const page = session?.pages.find((p) => p.id === target.pageId) ?? null;
  return {
    orbitId: orbit?.id ?? ATLAS_ORBITS[0].id,
    sessionId: session?.id ?? null,
    pageId: page?.id ?? null,
  };
}

export function VariantAtlasReplica() {
  const initial = useMemo(resolveInitialSelection, []);
  const { nav, patch, toggleIn, expandIn } = useSharedNavState();

  // 진입 시점의 선택을 공유 상태에 한 번 반영한다.
  useMemo(() => {
    patchNavState({
      focusedOrbitId: initial.orbitId,
      selectedSessionId: initial.sessionId,
      selectedPageId: initial.pageId,
      expandedOrbitIds: new Set([...getNavState().expandedOrbitIds, initial.orbitId]),
      expandedSessionIds: initial.sessionId
        ? new Set([...getNavState().expandedSessionIds, initial.sessionId])
        : getNavState().expandedSessionIds,
    });
    return null;
  }, [initial]);

  const focusedOrbitId = nav.focusedOrbitId ?? initial.orbitId;
  const selectedSessionId = nav.selectedSessionId;
  const selectedPageId = nav.selectedPageId;
  const navOpen = nav.open;

  const toggleNav = useCallback(() => patch({ open: !getNavState().open }), [patch]);

  const searchRef = useRef<HTMLInputElement>(null);

  const focusedOrbit = useMemo(
    () => ATLAS_ORBITS.find((o) => o.id === focusedOrbitId) ?? null,
    [focusedOrbitId]
  );
  const selectedSession = useMemo(
    () => focusedOrbit?.sessions.find((s) => s.id === selectedSessionId) ?? null,
    [focusedOrbit, selectedSessionId]
  );
  const selectedPage = useMemo(
    () => selectedSession?.pages.find((p) => p.id === selectedPageId) ?? null,
    [selectedSession, selectedPageId]
  );

  const orbitOfSession = useCallback(
    (sessionId: string) => ATLAS_ORBITS.find((o) => o.sessions.some((s) => s.id === sessionId)) ?? null,
    []
  );

  const selectOrbit = useCallback(
    (orbitId: string) => {
      patch({ focusedOrbitId: orbitId, selectedSessionId: null, selectedPageId: null });
      expandIn('expandedOrbitIds', orbitId);
    },
    [patch, expandIn]
  );

  const selectSession = useCallback(
    (sessionId: string) => {
      const orbit = orbitOfSession(sessionId);
      if (!orbit) return;
      patch({ focusedOrbitId: orbit.id, selectedSessionId: sessionId, selectedPageId: null });
      expandIn('expandedOrbitIds', orbit.id);
      expandIn('expandedSessionIds', sessionId);
    },
    [orbitOfSession, patch, expandIn]
  );

  const selectPageInSession = useCallback(
    (sessionId: string, pageId: string) => {
      const orbit = orbitOfSession(sessionId);
      if (!orbit) return;
      patch({ focusedOrbitId: orbit.id, selectedSessionId: sessionId, selectedPageId: pageId });
      expandIn('expandedOrbitIds', orbit.id);
      expandIn('expandedSessionIds', sessionId);
    },
    [orbitOfSession, patch, expandIn]
  );

  const resetSelection = useCallback(
    () => patch({ selectedSessionId: null, selectedPageId: null }),
    [patch]
  );

  const cycleSession = useCallback(
    (dir: 1 | -1) => {
      const sessions = focusedOrbit?.sessions ?? [];
      if (sessions.length === 0) return;
      const idx = sessions.findIndex((s) => s.id === selectedSessionId);
      const next = idx === -1 ? (dir === 1 ? 0 : sessions.length - 1) : (idx + dir + sessions.length) % sessions.length;
      selectSession(sessions[next].id);
    },
    [focusedOrbit, selectedSessionId, selectSession]
  );

  const cyclePage = useCallback(
    (dir: 1 | -1) => {
      if (!selectedSession || selectedSession.pages.length === 0) return;
      const pages = selectedSession.pages;
      const idx = pages.findIndex((p) => p.id === selectedPageId);
      const next = idx === -1 ? (dir === 1 ? 0 : pages.length - 1) : (idx + dir + pages.length) % pages.length;
      patch({ selectedPageId: pages[next].id });
    },
    [selectedSession, selectedPageId, patch]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        patch({ searchOpen: true });
        // 펼침 트랜지션이 시작된 뒤 포커스를 준다
        requestAnimationFrame(() => {
          searchRef.current?.focus();
          searchRef.current?.select();
        });
        return;
      }

      const tag = (e.target as HTMLElement)?.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA';

      if (e.key === 'Escape') {
        if (isTyping) {
          (e.target as HTMLElement).blur();
          return;
        }
        if (selectedPageId) patch({ selectedPageId: null });
        else if (selectedSessionId) patch({ selectedSessionId: null });
        return;
      }

      if (isTyping) return;

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        cycleSession(e.key === 'ArrowDown' ? 1 : -1);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        cyclePage(e.key === 'ArrowRight' ? 1 : -1);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cycleSession, cyclePage, selectedPageId, selectedSessionId, patch]);

  const collapseAll = useCallback(
    () => patch({ expandedOrbitIds: new Set(), expandedSessionIds: new Set() }),
    [patch]
  );

  return (
    <div
      className={cx('atlas-page', !navOpen && 'atlas-page--nav-closed')}
      style={{ '--atlas-nav-w': `${navOpen ? nav.width : 0}px` } as React.CSSProperties}
    >
      <AtlasHeader navOpen={navOpen} onToggleNav={toggleNav} />

      <AtlasNavigator
        orbits={ATLAS_ORBITS}
        query={nav.query}
        onQueryChange={(query) => patch({ query })}
        focusedOrbitId={focusedOrbitId}
        selectedSessionId={selectedSessionId}
        selectedPageId={selectedPageId}
        expandedOrbitIds={nav.expandedOrbitIds}
        expandedSessionIds={nav.expandedSessionIds}
        onToggleOrbit={(id) => toggleIn('expandedOrbitIds', id)}
        onToggleSession={(id) => toggleIn('expandedSessionIds', id)}
        onSelectOrbit={selectOrbit}
        onSelectSession={selectSession}
        onSelectPage={selectPageInSession}
        onCollapseAll={collapseAll}
        width={nav.width}
        onWidthChange={(width) => patch({ width })}
        searchOpen={nav.searchOpen}
        onSearchOpenChange={(searchOpen) => patch({ searchOpen })}
        searchInputRef={searchRef}
      />

      <main className="atlas-canvas">
        <AtlasCanvas
          orbit={focusedOrbit}
          selectedSessionId={selectedSessionId}
          selectedPageId={selectedPageId}
          onSelectSession={selectSession}
          onSelectPage={(pageId) => patch({ selectedPageId: pageId })}
          onClearSelection={resetSelection}
          bottomInset={selectedSession ? TRAY_INSET : 40}
        />

        {selectedSession && (
          <AtlasTray
            orbit={focusedOrbit}
            session={selectedSession}
            selectedPageId={selectedPageId}
            onSelectPage={(pageId) => patch({ selectedPageId: pageId })}
            onPrevSession={() => cycleSession(-1)}
            onNextSession={() => cycleSession(1)}
            onClose={resetSelection}
          />
        )}
      </main>

      <AtlasDetail
        orbit={focusedOrbit}
        session={selectedSession}
        page={selectedPage}
        onSelectPage={(pageId) => patch({ selectedPageId: pageId })}
      />
    </div>
  );
}
