import { useEffect } from 'react';
import { AtlasNavigator } from '../atlas/AtlasNavigator';
import { ATLAS_ORBITS } from '../atlas/data';
import { navigateToAtlas } from '../../lib/navigation';
import { useSharedNavState } from '../../lib/nav-state';

interface NavigatorDrawerProps {
  open: boolean;
  onClose: () => void;
  /** 위에 모달이 떠 있으면 Esc 를 그쪽에 양보한다 */
  escapeEnabled?: boolean;
}

const orbitOfSession = (sessionId: string) =>
  ATLAS_ORBITS.find((o) => o.sessions.some((s) => s.id === sessionId)) ?? null;

/**
 * 메인 화면의 좌측 네비게이터.
 * 아틀라스와 같은 컴포넌트 · 같은 공유 상태를 쓰므로 두 화면을 오갈 때
 * 펼침 · 선택 · 너비 · 검색이 그대로 유지된다.
 */
export function NavigatorDrawer({ open, onClose, escapeEnabled = true }: NavigatorDrawerProps) {
  const { nav, patch, toggleIn, expandIn } = useSharedNavState();

  useEffect(() => {
    if (!open || !escapeEnabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !nav.searchOpen) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, nav.searchOpen, escapeEnabled]);

  return (
    <div
      className={`nav-drawer${open ? ' nav-drawer--on' : ''}`}
      role="navigation"
      aria-label="네비게이터"
      aria-hidden={!open}
    >
      <AtlasNavigator
        orbits={ATLAS_ORBITS}
        query={nav.query}
        onQueryChange={(query) => patch({ query })}
        focusedOrbitId={nav.focusedOrbitId}
        selectedSessionId={nav.selectedSessionId}
        selectedPageId={nav.selectedPageId}
        expandedOrbitIds={nav.expandedOrbitIds}
        expandedSessionIds={nav.expandedSessionIds}
        onToggleOrbit={(id) => toggleIn('expandedOrbitIds', id)}
        onToggleSession={(id) => toggleIn('expandedSessionIds', id)}
        onSelectOrbit={(orbitId) => {
          patch({ focusedOrbitId: orbitId, selectedSessionId: null, selectedPageId: null });
          expandIn('expandedOrbitIds', orbitId);
          navigateToAtlas({ orbitId });
        }}
        onSelectSession={(sessionId) => {
          const orbit = orbitOfSession(sessionId);
          patch({
            focusedOrbitId: orbit?.id ?? null,
            selectedSessionId: sessionId,
            selectedPageId: null,
          });
          if (orbit) expandIn('expandedOrbitIds', orbit.id);
          expandIn('expandedSessionIds', sessionId);
          navigateToAtlas({ sessionId });
        }}
        onSelectPage={(sessionId, pageId) => {
          const orbit = orbitOfSession(sessionId);
          patch({
            focusedOrbitId: orbit?.id ?? null,
            selectedSessionId: sessionId,
            selectedPageId: pageId,
          });
          if (orbit) expandIn('expandedOrbitIds', orbit.id);
          expandIn('expandedSessionIds', sessionId);
          navigateToAtlas({ sessionId, pageId });
        }}
        onCollapseAll={() => patch({ expandedOrbitIds: new Set(), expandedSessionIds: new Set() })}
        width={nav.width}
        onWidthChange={(width) => patch({ width })}
        searchOpen={nav.searchOpen}
        onSearchOpenChange={(searchOpen) => patch({ searchOpen })}
      />
    </div>
  );
}
