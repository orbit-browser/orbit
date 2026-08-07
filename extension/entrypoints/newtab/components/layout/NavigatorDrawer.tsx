import { useEffect } from 'react';
import { AtlasNavigator } from '../atlas/AtlasNavigator';
import type { SessionNode } from '../atlas/data';
import { navigateToAtlas } from '../../lib/navigation';
import { useSharedNavState } from '../../lib/nav-state';

interface NavigatorDrawerProps {
  sessions: SessionNode[];
  open: boolean;
  onClose: () => void;
  escapeEnabled?: boolean;
}

export function NavigatorDrawer({
  sessions,
  open,
  onClose,
  escapeEnabled = true,
}: NavigatorDrawerProps) {
  const { nav, patch, toggleIn, expandIn } = useSharedNavState();

  useEffect(() => {
    if (!open || !escapeEnabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !nav.searchOpen) onClose();
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
        sessions={sessions}
        query={nav.query}
        onQueryChange={(query) => patch({ query })}
        focusedSessionId={nav.focusedOrbitId}
        selectedPageId={nav.selectedPageId}
        expandedSessionIds={nav.expandedSessionIds}
        onToggleSession={(id) => toggleIn('expandedSessionIds', id)}
        onSelectSession={(sessionId) => {
          patch({ focusedOrbitId: sessionId, selectedSessionId: null, selectedPageId: null });
          expandIn('expandedSessionIds', sessionId);
          navigateToAtlas({ sessionId });
        }}
        onSelectPage={(sessionId, pageId) => {
          patch({ focusedOrbitId: sessionId, selectedSessionId: null, selectedPageId: pageId });
          expandIn('expandedSessionIds', sessionId);
          navigateToAtlas({ sessionId, pageId });
        }}
        onCollapseAll={() => patch({ expandedSessionIds: new Set() })}
        width={nav.width}
        onWidthChange={(width) => patch({ width })}
        searchOpen={nav.searchOpen}
        onSearchOpenChange={(searchOpen) => patch({ searchOpen })}
      />
    </div>
  );
}
