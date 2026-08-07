import { useEffect, useMemo } from 'react';
import { navigate } from '../../lib/navigation';
import type { SessionNode } from './data';

const cx = (...classes: (string | false | undefined | null)[]) => classes.filter(Boolean).join(' ');

interface AtlasNavigatorProps {
  sessions: SessionNode[];
  query: string;
  onQueryChange: (value: string) => void;
  focusedSessionId: string | null;
  selectedPageId: string | null;
  expandedSessionIds: Set<string>;
  onToggleSession: (id: string) => void;
  onSelectSession: (id: string) => void;
  onSelectPage: (sessionId: string, pageId: string) => void;
  onCollapseAll: () => void;
  width: number;
  onWidthChange: (width: number) => void;
  resizable?: boolean;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  searchInputRef?: React.Ref<HTMLInputElement>;
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="atlas-nav__mark">{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  );
}

const NAV_MIN_WIDTH = 216;
const NAV_MAX_WIDTH = 420;

export function AtlasNavigator({
  sessions,
  query,
  onQueryChange,
  focusedSessionId,
  selectedPageId,
  expandedSessionIds,
  onToggleSession,
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
  useEffect(() => {
    if (query && !searchOpen) onSearchOpenChange(true);
  }, [query, searchOpen, onSearchOpenChange]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return sessions.map((session) => ({ session, pageIds: null as Set<string> | null }));

    return sessions.flatMap((session) => {
      const sessionHit =
        session.title.toLowerCase().includes(normalized) ||
        session.summary.overview.toLowerCase().includes(normalized);
      const pages = session.pages.filter(
        (page) =>
          page.title.toLowerCase().includes(normalized) ||
          page.domain.toLowerCase().includes(normalized),
      );
      if (!sessionHit && pages.length === 0) return [];
      return [{ session, pageIds: sessionHit ? null : new Set(pages.map((page) => page.id)) }];
    });
  }, [query, sessions]);

  const handleResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const onMove = (moveEvent: PointerEvent) => {
      onWidthChange(
        Math.min(NAV_MAX_WIDTH, Math.max(NAV_MIN_WIDTH, startWidth + moveEvent.clientX - startX)),
      );
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
          <i className="ph ph-house" />
        </button>
        <div className="atlas-nav__head-actions">
          <button type="button" title="모두 접기" aria-label="모두 접기" onClick={onCollapseAll}>
            <i className="ph ph-arrows-in-line-vertical" />
          </button>
        </div>
      </div>

      <div className="atlas-nav__tree">
        {filtered.length === 0 && (
          <div className="atlas-nav__empty">
            <i className="ph ph-magnifying-glass" />
            <span>{query ? `“${query}” 와 일치하는 항목이 없습니다` : '저장된 세션이 없습니다'}</span>
          </div>
        )}

        {filtered.map(({ session, pageIds }) => {
          const isOpen = pageIds !== null || expandedSessionIds.has(session.id);
          const visiblePages = pageIds
            ? session.pages.filter((page) => pageIds.has(page.id))
            : session.pages;

          return (
            <div className="atlas-branch" key={session.id}>
              <div
                className={cx(
                  'atlas-row',
                  'atlas-row--orbit',
                  focusedSessionId === session.id && 'atlas-row--focused',
                )}
                onClick={() => onSelectSession(session.id)}
                onKeyDown={(event) => event.key === 'Enter' && onSelectSession(session.id)}
                role="button"
                tabIndex={0}
                title={`${session.title} — ${session.date}`}
              >
                <button
                  type="button"
                  className="atlas-row__caret"
                  aria-label={isOpen ? '접기' : '펼치기'}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleSession(session.id);
                  }}
                >
                  <i className={isOpen ? 'ph ph-caret-down' : 'ph ph-caret-right'} />
                </button>
                {session.status === 'live' ? (
                  <span className="atlas-row__live" title="수집 중" />
                ) : (
                  <i className={`ph ${session.icon} atlas-row__icon`} style={{ color: session.hue }} />
                )}
                <span className="atlas-row__label">
                  <Highlight text={session.title} query={query} />
                </span>
                <span className="atlas-row__meta">{session.pages.length}p</span>
              </div>

              {isOpen && (
                <div
                  className="atlas-branch__children"
                  style={{ '--branch-hue': session.hue } as React.CSSProperties}
                >
                  {visiblePages.map((page) => (
                    <div
                      key={page.id}
                      className={cx(
                        'atlas-row',
                        'atlas-row--page',
                        selectedPageId === page.id && 'atlas-row--active',
                      )}
                      onClick={() => onSelectPage(session.id, page.id)}
                      onKeyDown={(event) =>
                        event.key === 'Enter' && onSelectPage(session.id, page.id)
                      }
                      role="button"
                      tabIndex={0}
                      title={`${page.title} — ${page.domain}`}
                    >
                      <span className="atlas-row__dot" />
                      <span className="atlas-row__label">
                        <Highlight text={page.title} query={query} />
                      </span>
                      {page.visits > 1 && (
                        <span className="atlas-row__meta atlas-row__meta--revisit">
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

      <div className={cx('atlas-nav__search', searchOpen && 'atlas-nav__search--open')}>
        <button
          type="button"
          className="atlas-nav__search-btn"
          aria-label={searchOpen ? '검색 닫기' : '검색 열기'}
          aria-expanded={searchOpen}
          onClick={() => onSearchOpenChange(!searchOpen || Boolean(query))}
        >
          <i className="ph ph-magnifying-glass" />
        </button>
        <input
          ref={searchInputRef}
          type="text"
          className="atlas-nav__search-input"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="세션 · 페이지 검색"
          spellCheck={false}
          tabIndex={searchOpen ? 0 : -1}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              onQueryChange('');
              onSearchOpenChange(false);
              event.currentTarget.blur();
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
            <i className="ph ph-x" />
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
