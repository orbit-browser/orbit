import { useEffect } from 'react';
import { AtlasNavigator } from '../atlas/AtlasNavigator';
import type { FolderNode, SessionNode } from '../atlas/data';
import { navigateToAtlas } from '../../lib/navigation';
import { useSharedNavState } from '../../lib/nav-state';

interface NavigatorDrawerProps {
  sessions: SessionNode[];
  folders: FolderNode[];
  unfiled: SessionNode[];
  open: boolean;
  onClose: () => void;
  escapeEnabled?: boolean;
}

export function NavigatorDrawer({
  sessions,
  folders,
  unfiled,
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
        folders={folders}
        unfiled={unfiled}
        query={nav.query}
        onQueryChange={(query) => patch({ query })}
        focusedFolderId={nav.focusedFolderId}
        focusedSessionId={nav.focusedOrbitId}
        selectedPageId={nav.selectedPageId}
        expandedFolderIds={nav.expandedOrbitIds}
        expandedSessionIds={nav.expandedSessionIds}
        onToggleFolder={(id) => toggleIn('expandedOrbitIds', id)}
        onToggleSession={(id) => toggleIn('expandedSessionIds', id)}
        onSelectFolder={(folderId) => {
          patch({
            focusedFolderId: folderId,
            focusedOrbitId: null,
            selectedSessionId: null,
            selectedPageId: null,
          });
          expandIn('expandedOrbitIds', folderId);
          navigateToAtlas({ orbitId: folderId });
        }}
        onSelectSession={(sessionId) => {
          patch({
            focusedFolderId: null,
            focusedOrbitId: sessionId,
            selectedSessionId: null,
            selectedPageId: null,
          });
          expandIn('expandedSessionIds', sessionId);
          navigateToAtlas({ sessionId });
        }}
        onSelectPage={(sessionId, pageId) => {
          patch({
            focusedFolderId: null,
            focusedOrbitId: sessionId,
            selectedSessionId: null,
            selectedPageId: pageId,
          });
          expandIn('expandedSessionIds', sessionId);
          navigateToAtlas({ sessionId, pageId });
        }}
        onCollapseAll={() =>
          patch({ expandedSessionIds: new Set(), expandedOrbitIds: new Set() })
        }
        width={nav.width}
        onWidthChange={(width) => patch({ width })}
        searchOpen={nav.searchOpen}
        onSearchOpenChange={(searchOpen) => patch({ searchOpen })}
      />
    </div>
  );
}
