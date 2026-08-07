import { useCallback, useEffect, useMemo, useRef } from 'react';
import '../styles/atlas.css';
import { AtlasHeader } from './atlas/AtlasHeader';
import { AtlasNavigator } from './atlas/AtlasNavigator';
import { AtlasCanvas } from './atlas/AtlasCanvas';
import { AtlasTray } from './atlas/AtlasTray';
import { AtlasDetail } from './atlas/AtlasDetail';
import { useAtlasData } from '../hooks/useAtlasData';
import { readAtlasTarget } from '../lib/navigation';
import { getNavState, useSharedNavState } from '../lib/nav-state';

const cx = (...classes: (string | false | undefined | null)[]) => classes.filter(Boolean).join(' ');
const TRAY_INSET = 250;

export function VariantAtlasReplica() {
  const atlasQuery = useAtlasData();
  const sessions = atlasQuery.data ?? [];
  const { nav, patch, toggleIn, expandIn } = useSharedNavState();
  const searchRef = useRef<HTMLInputElement>(null);
  const initializedRef = useRef(false);

  const initialTarget = useMemo(readAtlasTarget, []);
  const target = initializedRef.current ? null : initialTarget;
  const targetSession = target?.sessionId
    ? sessions.find((session) => session.id === target.sessionId)
    : undefined;
  const sharedSession = nav.focusedOrbitId
    ? sessions.find((session) => session.id === nav.focusedOrbitId)
    : undefined;
  const focusedSessionId = sharedSession?.id ?? targetSession?.id ?? sessions[0]?.id ?? null;
  const focusedSession = useMemo(
    () => sessions.find((session) => session.id === focusedSessionId) ?? null,
    [focusedSessionId, sessions],
  );
  const selectedPageId =
    focusedSession?.pages.some((page) => page.id === (nav.selectedPageId ?? target?.pageId))
      ? (nav.selectedPageId ?? target?.pageId ?? null)
      : null;
  const selectedPage =
    focusedSession?.pages.find((page) => page.id === selectedPageId) ?? null;

  useEffect(() => {
    if (!focusedSessionId) return;
    initializedRef.current = true;
    const current = getNavState();
    if (
      current.focusedOrbitId === focusedSessionId &&
      current.selectedPageId === selectedPageId
    ) return;
    patch({
      focusedOrbitId: focusedSessionId,
      selectedSessionId: null,
      selectedPageId,
      expandedSessionIds: new Set([...current.expandedSessionIds, focusedSessionId]),
    });
  }, [focusedSessionId, selectedPageId, patch]);

  const toggleNav = useCallback(() => patch({ open: !getNavState().open }), [patch]);

  const selectSession = useCallback(
    (sessionId: string) => {
      patch({ focusedOrbitId: sessionId, selectedSessionId: null, selectedPageId: null });
      expandIn('expandedSessionIds', sessionId);
    },
    [patch, expandIn],
  );

  const selectPageInSession = useCallback(
    (sessionId: string, pageId: string) => {
      patch({ focusedOrbitId: sessionId, selectedSessionId: null, selectedPageId: pageId });
      expandIn('expandedSessionIds', sessionId);
    },
    [patch, expandIn],
  );

  const cycleSession = useCallback(
    (direction: 1 | -1) => {
      if (sessions.length === 0) return;
      const index = sessions.findIndex((session) => session.id === focusedSessionId);
      const next =
        index === -1
          ? direction === 1 ? 0 : sessions.length - 1
          : (index + direction + sessions.length) % sessions.length;
      selectSession(sessions[next].id);
    },
    [focusedSessionId, selectSession, sessions],
  );

  const cyclePage = useCallback(
    (direction: 1 | -1) => {
      if (!focusedSession || focusedSession.pages.length === 0) return;
      const index = focusedSession.pages.findIndex((page) => page.id === selectedPageId);
      const next =
        index === -1
          ? direction === 1 ? 0 : focusedSession.pages.length - 1
          : (index + direction + focusedSession.pages.length) % focusedSession.pages.length;
      patch({ selectedPageId: focusedSession.pages[next].id });
    },
    [focusedSession, selectedPageId, patch],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        patch({ searchOpen: true });
        requestAnimationFrame(() => {
          searchRef.current?.focus();
          searchRef.current?.select();
        });
        return;
      }

      const tag = (event.target as HTMLElement)?.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA';
      if (event.key === 'Escape') {
        if (isTyping) (event.target as HTMLElement).blur();
        else if (selectedPageId) patch({ selectedPageId: null });
        return;
      }
      if (isTyping) return;

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        cycleSession(event.key === 'ArrowDown' ? 1 : -1);
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        cyclePage(event.key === 'ArrowRight' ? 1 : -1);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cycleSession, cyclePage, selectedPageId, patch]);

  return (
    <div
      className={cx('atlas-page', !nav.open && 'atlas-page--nav-closed')}
      style={{ '--atlas-nav-w': `${nav.open ? nav.width : 0}px` } as React.CSSProperties}
    >
      <AtlasHeader navOpen={nav.open} onToggleNav={toggleNav} />

      <AtlasNavigator
        sessions={sessions}
        query={nav.query}
        onQueryChange={(query) => patch({ query })}
        focusedSessionId={focusedSessionId}
        selectedPageId={selectedPageId}
        expandedSessionIds={nav.expandedSessionIds}
        onToggleSession={(id) => toggleIn('expandedSessionIds', id)}
        onSelectSession={selectSession}
        onSelectPage={selectPageInSession}
        onCollapseAll={() => patch({ expandedSessionIds: new Set() })}
        width={nav.width}
        onWidthChange={(width) => patch({ width })}
        searchOpen={nav.searchOpen}
        onSearchOpenChange={(searchOpen) => patch({ searchOpen })}
        searchInputRef={searchRef}
      />

      <main className="atlas-canvas">
        {atlasQuery.isPending ? (
          <div className="atlas-data-state" role="status">탐색 기록을 불러오는 중...</div>
        ) : atlasQuery.isError ? (
          <div className="atlas-data-state" role="alert">
            <span>백엔드에서 탐색 기록을 불러오지 못했어요.</span>
            <button type="button" onClick={() => void atlasQuery.refetch()}>다시 시도</button>
          </div>
        ) : (
          <AtlasCanvas
            session={focusedSession}
            selectedPageId={selectedPageId}
            onSelectPage={(pageId) => patch({ selectedPageId: pageId })}
            onClearSelection={() => patch({ selectedPageId: null })}
            bottomInset={focusedSession ? TRAY_INSET : 40}
          />
        )}

        {focusedSession && (
          <AtlasTray
            session={focusedSession}
            selectedPageId={selectedPageId}
            onSelectPage={(pageId) => patch({ selectedPageId: pageId })}
            onPrevSession={() => cycleSession(-1)}
            onNextSession={() => cycleSession(1)}
            onClose={() => patch({ selectedPageId: null })}
          />
        )}
      </main>

      <AtlasDetail
        session={focusedSession}
        page={selectedPage}
        onSelectPage={(pageId) => patch({ selectedPageId: pageId })}
      />
    </div>
  );
}
