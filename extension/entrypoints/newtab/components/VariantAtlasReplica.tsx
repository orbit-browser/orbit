import { useCallback, useEffect, useMemo, useRef } from 'react';
import '../styles/atlas.css';
import { AtlasHeader } from './atlas/AtlasHeader';
import { AtlasNavigator } from './atlas/AtlasNavigator';
import { AtlasCanvas } from './atlas/AtlasCanvas';
import { AtlasTray } from './atlas/AtlasTray';
import { AtlasDetail } from './atlas/AtlasDetail';
import {
  buildFolderScene,
  buildNavRows,
  buildSessionScene,
  sortSessions,
  stepNavRow,
  type NavRow,
} from './atlas/data';
import { useAtlasData } from '../hooks/useAtlasData';
import { readAtlasTarget } from '../lib/navigation';
import { getNavState, useSharedNavState } from '../lib/nav-state';

const cx = (...classes: (string | false | undefined | null)[]) => classes.filter(Boolean).join(' ');
const TRAY_INSET = 250;

export function VariantAtlasReplica() {
  const atlasQuery = useAtlasData();
  const sessions = atlasQuery.data?.sessions ?? [];
  const folders = atlasQuery.data?.folders ?? [];
  const unfiled = atlasQuery.data?.unfiled ?? [];
  const { nav, patch, toggleIn, expandIn } = useSharedNavState();
  const searchRef = useRef<HTMLInputElement>(null);
  const initializedRef = useRef(false);

  const initialTarget = useMemo(readAtlasTarget, []);
  const target = initializedRef.current ? null : initialTarget;
  const targetSession = target?.sessionId
    ? sessions.find((session) => session.id === target.sessionId)
    : undefined;

  /*
   * 정렬을 여기서 한 번만 적용한다.
   *
   * 캔버스는 궤도를 안쪽부터 바깥으로 그리고 ↑↓ 도 그 순서로 내려간다 — 네비게이터가
   * 보여 주는 순서와 다르면 "위에서 아래로"가 두 화면에서 서로 다른 뜻이 된다.
   */
  const sortedFolders = useMemo(
    () =>
      folders.map((folder) => ({
        ...folder,
        sessions: sortSessions(folder.sessions, nav.sessionSort),
      })),
    [folders, nav.sessionSort],
  );
  const sortedUnfiled = useMemo(
    () => sortSessions(unfiled, nav.sessionSort),
    [unfiled, nav.sessionSort],
  );

  // 폴더 포커스가 세션 포커스보다 우선한다 — 둘 다 켜져 있으면 중심이 둘이 된다.
  // URL 의 orbit 파라미터로도 열 수 있어 새로고침해도 같은 폴더가 뜬다.
  const focusedFolderId = nav.focusedFolderId ?? target?.orbitId ?? null;
  const focusedFolder = focusedFolderId
    ? sortedFolders.find((folder) => folder.id === focusedFolderId)
    : undefined;

  const sharedSession = nav.focusedOrbitId
    ? sessions.find((session) => session.id === nav.focusedOrbitId)
    : undefined;
  const focusedSessionId = focusedFolder
    ? null
    : sharedSession?.id ?? targetSession?.id ?? sessions[0]?.id ?? null;
  const focusedSession = useMemo(
    () => sessions.find((session) => session.id === focusedSessionId) ?? null,
    [focusedSessionId, sessions],
  );

  const scene = useMemo(() => {
    if (focusedFolder) return buildFolderScene(focusedFolder);
    if (focusedSession) return buildSessionScene(focusedSession);
    return null;
  }, [focusedFolder, focusedSession]);

  /**
   * 트레이·상세가 다룰 세션.
   *
   * 폴더를 보는 중에는 중심이 폴더라 "현재 세션"이 없다 — 점을 고르면 그 점이 속한
   * 세션이 대상이 된다.
   */
  const activeSession = focusedFolder
    ? sessions.find((session) => session.id === nav.selectedSessionId) ?? null
    : focusedSession;

  const selectedPageId =
    activeSession?.pages.some((page) => page.id === (nav.selectedPageId ?? target?.pageId))
      ? (nav.selectedPageId ?? target?.pageId ?? null)
      : null;
  const selectedPage = activeSession?.pages.find((page) => page.id === selectedPageId) ?? null;

  useEffect(() => {
    if (focusedFolder || !focusedSessionId) return;
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
  }, [focusedFolder, focusedSessionId, selectedPageId, patch]);

  const toggleNav = useCallback(() => patch({ open: !getNavState().open }), [patch]);

  const selectSession = useCallback(
    (sessionId: string) => {
      patch({
        focusedFolderId: null,
        focusedOrbitId: sessionId,
        selectedSessionId: null,
        selectedPageId: null,
      });
      expandIn('expandedSessionIds', sessionId);
    },
    [patch, expandIn],
  );

  const selectFolder = useCallback(
    (folderId: string) => {
      patch({
        focusedFolderId: folderId,
        focusedOrbitId: null,
        selectedSessionId: null,
        selectedPageId: null,
      });
      expandIn('expandedOrbitIds', folderId);
    },
    [patch, expandIn],
  );

  const selectPageInSession = useCallback(
    (sessionId: string, pageId: string) => {
      patch({
        focusedFolderId: null,
        focusedOrbitId: sessionId,
        selectedSessionId: null,
        selectedPageId: pageId,
      });
      expandIn('expandedSessionIds', sessionId);
    },
    [patch, expandIn],
  );

  /**
   * 폴더 씬에서 궤도(=세션)를 펼친다.
   *
   * 세션 씬으로 넘어가지 않고 이 화면에서 그 세션의 페이지만 드러낸다 — 폴더 안을
   * 훑는 동안 화면이 바뀌면 어디를 보고 있었는지 잃는다. 다시 누르면 접는다.
   */
  const openTrack = useCallback(
    (sessionId: string) => {
      const current = getNavState().selectedSessionId;
      patch({
        selectedSessionId: current === sessionId ? null : sessionId,
        selectedPageId: null,
      });
    },
    [patch],
  );

  /** 캔버스의 점 선택 — 폴더 씬이면 그 점이 어느 세션 것인지 함께 기록한다. */
  const selectPoint = useCallback(
    (pointId: string, sessionId: string | null) => {
      patch(
        sessionId
          ? { selectedPageId: pointId, selectedSessionId: sessionId }
          : { selectedPageId: pointId },
      );
    },
    [patch],
  );

  /** 지금 보고 있는 폴더 — 세로 이동에서 이 폴더의 세션만 목록에 낀다. */
  const openFolderId = focusedFolder?.id ?? focusedSession?.folderId ?? null;

  const navRows = useMemo(
    () => buildNavRows(sortedFolders, sortedUnfiled, openFolderId),
    [sortedFolders, sortedUnfiled, openFolderId],
  );

  /**
   * ↑↓ — 네비게이터에 보이는 세로 순서 그대로 한 칸 옮긴다.
   *
   * 폴더끼리, 폴더 안 세션끼리, 정리 안 된 세션끼리가 한 줄로 이어져 있어 끝에 닿으면
   * 다음 층으로 자연스럽게 넘어간다.
   */
  const stepVertically = useCallback(
    (direction: 1 | -1) => {
      const current: NavRow = {
        folderId: openFolderId,
        sessionId: focusedFolder ? getNavState().selectedSessionId : focusedSession?.id ?? null,
      };
      const row = stepNavRow(navRows, current, direction);
      if (!row) return;

      if (row.sessionId === null) {
        selectFolder(row.folderId as string);
        return;
      }
      if (row.folderId === null) {
        selectSession(row.sessionId);
        return;
      }
      // 폴더 안 세션 — 폴더 화면을 유지한 채 그 세션의 궤도를 펼친다.
      patch({
        focusedFolderId: row.folderId,
        focusedOrbitId: null,
        selectedSessionId: row.sessionId,
        selectedPageId: null,
      });
      expandIn('expandedOrbitIds', row.folderId);
    },
    [navRows, openFolderId, focusedFolder, focusedSession, selectFolder, selectSession, patch, expandIn],
  );

  const cycleSession = useCallback(
    (direction: 1 | -1) => {
      if (sessions.length === 0) return;
      const index = sessions.findIndex((session) => session.id === activeSession?.id);
      const next =
        index === -1
          ? direction === 1 ? 0 : sessions.length - 1
          : (index + direction + sessions.length) % sessions.length;
      selectSession(sessions[next].id);
    },
    [activeSession, selectSession, sessions],
  );

  /*
   * ↑↓ 는 네비게이터 세로 이동, ←→ 는 캔버스가 궤도 안 페이지 이동에 쓴다.
   * 그 밖에 검색 열기와 선택 해제를 여기서 다룬다.
   */
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

      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        event.preventDefault();
        stepVertically(event.key === 'ArrowDown' ? 1 : -1);
        return;
      }

      if (event.key !== 'Escape') return;
      if (tag === 'INPUT' || tag === 'TEXTAREA') (event.target as HTMLElement).blur();
      else if (selectedPageId) patch({ selectedPageId: null });
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedPageId, patch, stepVertically]);

  return (
    <div
      className={cx('atlas-page', !nav.open && 'atlas-page--nav-closed')}
      style={{ '--atlas-nav-w': `${nav.open ? nav.width : 0}px` } as React.CSSProperties}
    >
      <AtlasHeader navOpen={nav.open} onToggleNav={toggleNav} />

      <AtlasNavigator
        folders={sortedFolders}
        unfiled={sortedUnfiled}
        sessions={sessions}
        query={nav.query}
        onQueryChange={(query) => patch({ query })}
        focusedFolderId={focusedFolder?.id ?? null}
        focusedSessionId={focusedSessionId}
        selectedPageId={selectedPageId}
        expandedFolderIds={nav.expandedOrbitIds}
        expandedSessionIds={nav.expandedSessionIds}
        onToggleFolder={(id) => toggleIn('expandedOrbitIds', id)}
        onToggleSession={(id) => toggleIn('expandedSessionIds', id)}
        onSelectFolder={selectFolder}
        onSelectSession={selectSession}
        onSelectPage={selectPageInSession}
        onCollapseAll={() =>
          patch({ expandedSessionIds: new Set(), expandedOrbitIds: new Set() })
        }
        width={nav.width}
        onWidthChange={(width) => patch({ width })}
        searchOpen={nav.searchOpen}
        onSearchOpenChange={(searchOpen) => patch({ searchOpen })}
        searchInputRef={searchRef}
        sort={nav.sessionSort}
        onSortChange={(sessionSort) => patch({ sessionSort })}
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
            scene={scene}
            activeTrackId={focusedFolder ? nav.selectedSessionId : null}
            selectedPointId={selectedPageId}
            onSelectPoint={selectPoint}
            onSelectTrack={openTrack}
            onClearSelection={() => patch({ selectedPageId: null, selectedSessionId: null })}
            bottomInset={activeSession ? TRAY_INSET : 40}
          />
        )}

        {activeSession && (
          <AtlasTray
            session={activeSession}
            selectedPageId={selectedPageId}
            onSelectPage={(pageId) => patch({ selectedPageId: pageId })}
            onPrevSession={() => cycleSession(-1)}
            onNextSession={() => cycleSession(1)}
            onClose={() => patch({ selectedPageId: null })}
          />
        )}
      </main>

      <AtlasDetail
        folder={focusedFolder ?? null}
        session={activeSession}
        page={selectedPage}
        onSelectPage={(pageId) => patch({ selectedPageId: pageId })}
        onSelectSession={openTrack}
      />
    </div>
  );
}
