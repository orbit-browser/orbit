import { useEffect, useMemo, useRef, useState } from 'react';
import { BookmarkPlus, CheckCheck, ExternalLink, Loader2, Search, X } from 'lucide-react';
import { activateOpenTab, bookmarkOpenTabs } from '../../../lib/chrome-bridge';
import { filterOpenTabs, openTabLocationLabel } from '../../../lib/tab-actions';
import type { OpenTabItem } from '../../../lib/types';
import { useOpenTabs } from '../hooks/useTabs';
import { useUIStore } from '../store/ui';
import { Favicon } from './Favicon';

export function OpenTabsPanel() {
  const { data: tabs = [], isLoading, isError } = useOpenTabs();
  const showToast = useUIStore((state) => state.showToast);
  const [query, setQuery] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBookmarking, setIsBookmarking] = useState(false);
  const filterInputRef = useRef<HTMLInputElement>(null);

  const filteredTabs = useMemo(() => filterOpenTabs(tabs, query), [tabs, query]);
  const selectedTabs = useMemo(
    () => tabs.filter((tab) => selectedIds.has(tab.id)),
    [selectedIds, tabs],
  );
  const visibleBookmarkableIds = filteredTabs
    .filter((tab) => tab.bookmarkable)
    .map((tab) => tab.id);
  const allVisibleSelected =
    visibleBookmarkableIds.length > 0 &&
    visibleBookmarkableIds.every((id) => selectedIds.has(id));

  useEffect(() => {
    const validIds = new Set(tabs.filter((tab) => tab.bookmarkable).map((tab) => tab.id));
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => validIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [tabs]);

  useEffect(() => {
    if (filterOpen) filterInputRef.current?.focus({ preventScroll: true });
  }, [filterOpen]);

  function closeFilter() {
    setQuery('');
    setFilterOpen(false);
    filterInputRef.current?.blur();
  }

  function toggleSelection(tab: OpenTabItem) {
    if (!tab.bookmarkable) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(tab.id)) next.delete(tab.id);
      else next.add(tab.id);
      return next;
    });
  }

  function toggleVisibleSelection() {
    setSelectedIds((current) => {
      const next = new Set(current);
      visibleBookmarkableIds.forEach((id) => {
        if (allVisibleSelected) next.delete(id);
        else next.add(id);
      });
      return next;
    });
  }

  async function handleActivate(tab: OpenTabItem) {
    try {
      await activateOpenTab(tab);
      showToast(`“${tab.title}” 탭으로 이동했어요`);
    } catch {
      showToast('탭을 찾지 못했어요. 목록을 새로고침해 주세요.');
    }
  }

  async function handleBookmark() {
    if (selectedTabs.length === 0 || isBookmarking) return;
    setIsBookmarking(true);
    try {
      const result = await bookmarkOpenTabs(selectedTabs);
      const failedIds = new Set(result.failedTabIds);
      setSelectedIds(failedIds);

      if (result.failedTabIds.length > 0) {
        showToast(
          `${result.createdCount}개 추가, ${result.failedTabIds.length}개 실패했어요`,
        );
      } else if (result.createdCount > 0 && result.skippedCount > 0) {
        showToast(`${result.createdCount}개 추가, 중복 ${result.skippedCount}개는 건너뛰었어요`);
      } else if (result.createdCount > 0) {
        showToast(`${result.createdCount}개 탭을 기타 북마크에 추가했어요`);
      } else {
        showToast('선택한 탭은 이미 북마크에 있어요');
      }
    } catch {
      showToast('북마크를 추가하지 못했어요. 확장 권한을 확인해 주세요.');
    } finally {
      setIsBookmarking(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div
        className={`grid shrink-0 transition-[grid-template-rows] duration-200 ease-out ${
          filterOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <div
            className={`px-3 pb-1 pt-2.5 transition-[opacity,transform] duration-200 ease-out ${
              filterOpen ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0'
            }`}
          >
            <div className="relative">
              <Search
                size={13}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-orbit-muted"
              />
              <input
                ref={filterInputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') closeFilter();
                }}
                placeholder="제목·사이트로 걸러내기"
                aria-label="열린 탭 걸러내기"
                tabIndex={filterOpen ? 0 : -1}
                aria-hidden={!filterOpen}
                className="h-8 w-full rounded-lg border border-orbit-border/70 bg-orbit-surface pl-8 pr-8 text-xs text-orbit-text outline-none transition focus:border-orbit-primary/60"
              />
              <button
                type="button"
                onClick={closeFilter}
                aria-label="검색 닫기"
                title="닫기 (Esc)"
                tabIndex={filterOpen ? 0 : -1}
                aria-hidden={!filterOpen}
                className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded p-0.5 text-orbit-muted transition hover:text-orbit-text"
              >
                <X size={12} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className={`shrink-0 px-3 ${filterOpen ? 'pt-0' : 'pt-2.5'}`}>
        <div className="flex items-center justify-between gap-2 px-2 pb-1.5 pt-1">
          <p className="text-xs font-semibold text-orbit-muted">
            열린 탭
            <span className="ml-1 font-normal tabular-nums">
              {query.trim() ? `${filteredTabs.length}/${tabs.length}` : tabs.length}
            </span>
          </p>
          <div className="flex shrink-0 items-center gap-1 text-[10px] text-orbit-muted">
            <button
              type="button"
              onClick={toggleVisibleSelection}
              disabled={visibleBookmarkableIds.length === 0}
              className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 font-semibold transition hover:bg-orbit-surface hover:text-orbit-text disabled:cursor-default disabled:opacity-40"
            >
              <CheckCheck size={11} />
              {allVisibleSelected ? '선택 해제' : query.trim() ? '결과 선택' : '전체 선택'}
            </button>
            {!filterOpen && (
              <button
                type="button"
                onClick={() => setFilterOpen(true)}
                title="열린 탭 검색"
                aria-label="열린 탭 검색"
                className="-mr-1 cursor-pointer rounded p-1 text-orbit-muted transition hover:bg-orbit-surface hover:text-orbit-text"
              >
                <Search size={12} />
              </button>
            )}
          </div>
        </div>
      </div>

      {selectedTabs.length > 0 && (
        <div className="shrink-0 px-3 pb-1 pt-0.5">
          <div className="flex min-h-9 items-center justify-between gap-3 rounded-lg bg-orbit-primary-soft px-2.5 py-1">
            <span className="text-[11px] font-semibold text-orbit-text">
              {selectedTabs.length}개 선택됨
            </span>
            <button
              type="button"
              onClick={() => void handleBookmark()}
              disabled={isBookmarking}
              className="flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[11px] font-semibold text-orbit-primary transition hover:bg-orbit-surface/70 disabled:cursor-default disabled:opacity-55"
            >
              {isBookmarking ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <BookmarkPlus size={12} />
              )}
              북마크
            </button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-1">
        {isLoading ? (
          <div className="flex h-28 items-center justify-center gap-2 text-xs text-orbit-muted">
            <Loader2 size={14} className="animate-spin" /> 열린 탭 확인 중…
          </div>
        ) : isError ? (
          <p className="p-6 text-center text-xs text-orbit-danger">열린 탭을 불러오지 못했어요.</p>
        ) : filteredTabs.length === 0 ? (
          <p className="p-6 text-center text-xs text-orbit-muted">
            {tabs.length === 0 ? '열린 웹 탭이 없어요.' : '검색과 일치하는 탭이 없어요.'}
          </p>
        ) : (
          <div className="space-y-0.5">
            {filteredTabs.map((tab) => (
              <div
                key={tab.id}
                className={
                  'group flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition ' +
                  (selectedIds.has(tab.id)
                    ? 'bg-orbit-primary-soft/70'
                    : 'hover:bg-orbit-surface')
                }
              >
                {tab.bookmarkable ? (
                  <input
                    type="checkbox"
                    checked={selectedIds.has(tab.id)}
                    onChange={() => toggleSelection(tab)}
                    aria-label={`${tab.title} 북마크 선택`}
                    title="북마크에 추가할 탭 선택"
                    className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-orbit-primary"
                  />
                ) : (
                  <span className="h-3.5 w-3.5 shrink-0" aria-hidden />
                )}
                <Favicon pageUrl={tab.url} src={tab.favIconUrl} />
                <button
                  type="button"
                  onClick={() => void handleActivate(tab)}
                  title={`${tab.title}\n${tab.url}\n이 탭으로 이동`}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-[13px] font-medium text-orbit-text">
                        {tab.title}
                      </p>
                      {tab.active && (
                        <span className="flex shrink-0 items-center gap-1 text-[9px] font-semibold text-orbit-primary">
                          <span className="h-1.5 w-1.5 rounded-full bg-orbit-primary" /> 현재
                        </span>
                      )}
                    </div>
                    <p className="truncate text-[10px] leading-4 text-orbit-muted">
                      {openTabLocationLabel(tab.url)}
                    </p>
                  </div>
                  <span className="-ml-2 w-0 shrink-0 overflow-hidden text-orbit-muted opacity-0 transition-all duration-150 group-hover:ml-0 group-hover:w-5 group-hover:opacity-100 group-focus-within:ml-0 group-focus-within:w-5 group-focus-within:opacity-100">
                    <ExternalLink size={12} />
                  </span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
