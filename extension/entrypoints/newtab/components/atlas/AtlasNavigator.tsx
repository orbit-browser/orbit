import { useEffect, useMemo } from 'react';
import { navigate } from '../../lib/navigation';
import type { OrbitNode, SessionNode } from './data';

const cx = (...classes: (string | false | undefined | null)[]) => classes.filter(Boolean).join(' ');

interface AtlasNavigatorProps {
  orbits: OrbitNode[];
  query: string;
  onQueryChange: (value: string) => void;
  focusedOrbitId: string | null;
  selectedSessionId: string | null;
  selectedPageId: string | null;
  expandedOrbitIds: Set<string>;
  expandedSessionIds: Set<string>;
  onToggleOrbit: (id: string) => void;
  onToggleSession: (id: string) => void;
  onSelectOrbit: (id: string) => void;
  onSelectSession: (id: string) => void;
  onSelectPage: (sessionId: string, pageId: string) => void;
  onCollapseAll: () => void;
  width: number;
  onWidthChange: (width: number) => void;
  /** 드로어에서 쓸 때처럼 너비를 고정하고 싶으면 false */
  resizable?: boolean;
  /** 하단 검색 열림 상태 (⌘K 로도 열 수 있어야 해서 부모가 쥔다) */
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  searchInputRef?: React.Ref<HTMLInputElement>;
}

/** 필터에 걸린 부분 문자열을 <mark> 로 감싼다. */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="atlas-nav__mark">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

interface FilteredOrbit {
  orbit: OrbitNode;
  sessions: { session: SessionNode; pageIds: Set<string> | null }[];
  /** 필터 때문에 강제로 펼쳐야 하는지 */
  forceOpen: boolean;
}

const NAV_MIN_WIDTH = 216;
const NAV_MAX_WIDTH = 420;

export function AtlasNavigator({
  orbits,
  query,
  onQueryChange,
  focusedOrbitId,
  selectedSessionId,
  selectedPageId,
  expandedOrbitIds,
  expandedSessionIds,
  onToggleOrbit,
  onToggleSession,
  onSelectOrbit,
  onSelectSession,
  onSelectPage,
  onCollapseAll,
  width,
  onWidthChange,
  resizable = true,
  searchOpen,
  onSearchOpenChange,
  searchInputRef,
}: AtlasNavigatorProps) {
  // 검색어가 남아 있으면 닫지 않는다.
  useEffect(() => {
    if (query && !searchOpen) onSearchOpenChange(true);
  }, [query, searchOpen, onSearchOpenChange]);

  const filtered = useMemo<FilteredOrbit[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return orbits.map((orbit) => ({
        orbit,
        sessions: orbit.sessions.map((session) => ({ session, pageIds: null })),
        forceOpen: false,
      }));
    }

    const result: FilteredOrbit[] = [];
    orbits.forEach((orbit) => {
      const orbitHit = orbit.title.toLowerCase().includes(q) || orbit.category.toLowerCase().includes(q);
      const sessions: FilteredOrbit['sessions'] = [];

      orbit.sessions.forEach((session) => {
        const sessionHit = session.title.toLowerCase().includes(q);
        const matchedPages = session.pages.filter(
          (p) => p.title.toLowerCase().includes(q) || p.domain.toLowerCase().includes(q)
        );
        if (sessionHit || matchedPages.length > 0) {
          sessions.push({
            session,
            pageIds: sessionHit ? null : new Set(matchedPages.map((p) => p.id)),
          });
        } else if (orbitHit) {
          sessions.push({ session, pageIds: null });
        }
      });

      if (orbitHit || sessions.length > 0) {
        result.push({ orbit, sessions, forceOpen: true });
      }
    });
    return result;
  }, [orbits, query]);

  const handleResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const onMove = (ev: PointerEvent) => {
      const next = Math.min(NAV_MAX_WIDTH, Math.max(NAV_MIN_WIDTH, startWidth + (ev.clientX - startX)));
      onWidthChange(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.classList.remove('atlas-resizing');
    };
    document.body.classList.add('atlas-resizing');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <aside className="atlas-nav" style={{ width }}>
      <div className="atlas-nav__head">
        <button type="button" title="메인으로" aria-label="메인으로" onClick={() => navigate('#/')}>
          <i className="ph ph-house"></i>
        </button>
        <div className="atlas-nav__head-actions">
          <button type="button" title="모두 접기" aria-label="모두 접기" onClick={onCollapseAll}>
            <i className="ph ph-arrows-in-line-vertical"></i>
          </button>
          <button type="button" title="새 Orbit" aria-label="새 Orbit">
            <i className="ph ph-plus"></i>
          </button>
        </div>
      </div>

      <div className="atlas-nav__tree">
        {filtered.length === 0 && (
          <div className="atlas-nav__empty">
            <i className="ph ph-magnifying-glass"></i>
            <span>“{query}” 와 일치하는 항목이 없습니다</span>
          </div>
        )}

        {filtered.map(({ orbit, sessions, forceOpen }) => {
          const isOpen = forceOpen || expandedOrbitIds.has(orbit.id);
          const isFocused = focusedOrbitId === orbit.id;

          return (
            <div className="atlas-branch" key={orbit.id}>
              <div
                className={cx('atlas-row', 'atlas-row--orbit', isFocused && 'atlas-row--focused')}
                onClick={() => onSelectOrbit(orbit.id)}
                onKeyDown={(e) => e.key === 'Enter' && onSelectOrbit(orbit.id)}
                role="button"
                tabIndex={0}
                title={`${orbit.title} — ${orbit.category}`}
              >
                <button
                  type="button"
                  className="atlas-row__caret"
                  aria-label={isOpen ? '접기' : '펼치기'}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleOrbit(orbit.id);
                  }}
                >
                  <i className={isOpen ? 'ph ph-caret-down' : 'ph ph-caret-right'}></i>
                </button>
                <i className={cx('ph', orbit.icon, 'atlas-row__icon')} style={{ color: orbit.hue }}></i>
                <span className="atlas-row__label">
                  <Highlight text={orbit.title} query={query} />
                </span>
                <span className="atlas-row__meta">{orbit.sessions.length}</span>
              </div>

              {isOpen && (
                <div className="atlas-branch__children" style={{ '--branch-hue': orbit.hue } as React.CSSProperties}>
                  {sessions.map(({ session, pageIds }) => {
                    const isSessionOpen = pageIds !== null || expandedSessionIds.has(session.id);
                    const isSessionActive = selectedSessionId === session.id;
                    const visiblePages = pageIds
                      ? session.pages.filter((p) => pageIds.has(p.id))
                      : session.pages;

                    return (
                      <div className="atlas-branch" key={session.id}>
                        <div
                          className={cx('atlas-row', 'atlas-row--session', isSessionActive && 'atlas-row--active')}
                          onClick={() => onSelectSession(session.id)}
                          onKeyDown={(e) => e.key === 'Enter' && onSelectSession(session.id)}
                          role="button"
                          tabIndex={0}
                          title={session.title}
                        >
                          <button
                            type="button"
                            className="atlas-row__caret"
                            aria-label={isSessionOpen ? '접기' : '펼치기'}
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleSession(session.id);
                            }}
                          >
                            <i className={isSessionOpen ? 'ph ph-caret-down' : 'ph ph-caret-right'}></i>
                          </button>
                          {session.status === 'live' && <span className="atlas-row__live" title="수집 중" />}
                          <span className="atlas-row__label">
                            <Highlight text={session.title} query={query} />
                          </span>
                          <span className="atlas-row__meta">{session.pages.length}p</span>
                        </div>

                        {isSessionOpen && (
                          <div className="atlas-branch__children">
                            {visiblePages.map((page) => (
                              <div
                                key={page.id}
                                className={cx(
                                  'atlas-row',
                                  'atlas-row--page',
                                  selectedPageId === page.id && 'atlas-row--active'
                                )}
                                onClick={() => onSelectPage(session.id, page.id)}
                                onKeyDown={(e) => e.key === 'Enter' && onSelectPage(session.id, page.id)}
                                role="button"
                                tabIndex={0}
                                title={`${page.title} — ${page.domain}`}
                              >
                                <span className="atlas-row__dot" />
                                <span className="atlas-row__label">
                                  <Highlight text={page.title} query={query} />
                                </span>
                                {page.visits > 1 && (
                                  <span className="atlas-row__meta atlas-row__meta--revisit" title={`${page.visits}회 방문`}>
                                    ×{page.visits}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className={cx('atlas-nav__search', searchOpen && 'atlas-nav__search--open')}>
        <button
          type="button"
          className="atlas-nav__search-btn"
          aria-label={searchOpen ? '검색 닫기' : '검색 열기'}
          aria-expanded={searchOpen}
          onClick={() => {
            if (searchOpen && !query) onSearchOpenChange(false);
            else onSearchOpenChange(true);
          }}
        >
          <i className="ph ph-magnifying-glass"></i>
        </button>
        <input
          ref={searchInputRef}
          type="text"
          className="atlas-nav__search-input"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Orbit · 세션 · 페이지 검색"
          spellCheck={false}
          tabIndex={searchOpen ? 0 : -1}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              onQueryChange('');
              onSearchOpenChange(false);
              e.currentTarget.blur();
            }
          }}
        />
        {query && (
          <button
            type="button"
            className="atlas-nav__search-clear"
            aria-label="검색어 지우기"
            onClick={() => onQueryChange('')}
          >
            <i className="ph ph-x"></i>
          </button>
        )}
      </div>

      {resizable && (
        <div
          className="atlas-nav__resizer"
          onPointerDown={handleResizeStart}
          onDoubleClick={() => onWidthChange(272)}
          role="separator"
          aria-orientation="vertical"
          aria-label="네비게이터 너비 조절"
        />
      )}
    </aside>
  );
}
