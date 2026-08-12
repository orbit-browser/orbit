import { useEffect, useMemo, useState } from 'react';
import { BookmarkPlus, CheckCheck, Loader2, LocateFixed, Search } from 'lucide-react';
import { activateOpenTab, bookmarkOpenTabs } from '../../../lib/chrome-bridge';
import { filterOpenTabs } from '../../../lib/tab-actions';
import type { OpenTabItem } from '../../../lib/types';
import { useOpenTabs } from '../hooks/useTabs';
import { useUIStore } from '../store/ui';
import { Favicon } from './Favicon';

export function OpenTabsPanel() {
  const { data: tabs = [], isLoading, isError } = useOpenTabs();
  const showToast = useUIStore((state) => state.showToast);
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBookmarking, setIsBookmarking] = useState(false);

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

  const windowNumbers = useMemo(() => {
    const ids = [...new Set(tabs.map((tab) => tab.windowId))];
    return new Map(ids.map((windowId, index) => [windowId, index + 1]));
  }, [tabs]);

  useEffect(() => {
    const validIds = new Set(tabs.filter((tab) => tab.bookmarkable).map((tab) => tab.id));
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => validIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [tabs]);

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
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-orbit-card border border-orbit-border bg-orbit-surface shadow-orbit-card">
      <div className="shrink-0 space-y-3 border-b border-orbit-border/60 p-3">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-orbit-muted"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="열린 탭 제목이나 주소 찾기"
              aria-label="열린 탭 검색"
              className="h-9 w-full rounded-xl border border-orbit-border bg-orbit-bg pl-9 pr-3 text-xs text-orbit-text outline-none transition focus:border-orbit-primary/60"
            />
          </div>
          <button
            type="button"
            onClick={() => void handleBookmark()}
            disabled={selectedTabs.length === 0 || isBookmarking}
            className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl bg-orbit-primary px-3 text-xs font-bold text-white transition hover:brightness-95 disabled:cursor-default disabled:opacity-45"
          >
            {isBookmarking ? <Loader2 size={13} className="animate-spin" /> : <BookmarkPlus size={13} />}
            북마크 {selectedTabs.length > 0 ? selectedTabs.length : ''}
          </button>
        </div>

        <div className="flex items-center justify-between text-[11px] text-orbit-muted">
          <span>{query.trim() ? `검색 결과 ${filteredTabs.length}개` : `전체 ${tabs.length}개 탭`}</span>
          <button
            type="button"
            onClick={toggleVisibleSelection}
            disabled={visibleBookmarkableIds.length === 0}
            className="flex cursor-pointer items-center gap-1 font-semibold transition hover:text-orbit-text disabled:cursor-default disabled:opacity-40"
          >
            <CheckCheck size={12} /> {allVisibleSelected ? '검색 결과 선택 해제' : '검색 결과 전체 선택'}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
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
          filteredTabs.map((tab) => (
            <div
              key={tab.id}
              className="group flex items-center gap-2 rounded-xl px-2 py-2 transition hover:bg-orbit-bg"
            >
              <input
                type="checkbox"
                checked={selectedIds.has(tab.id)}
                disabled={!tab.bookmarkable}
                onChange={() => toggleSelection(tab)}
                aria-label={`${tab.title} 북마크 선택`}
                title={tab.bookmarkable ? '북마크에 추가할 탭 선택' : '이 페이지는 북마크할 수 없어요'}
                className="h-3.5 w-3.5 shrink-0 accent-orbit-primary disabled:opacity-30"
              />
              <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white">
                <Favicon src={tab.favIconUrl} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-xs font-semibold text-orbit-text">{tab.title}</p>
                  {tab.active && (
                    <span className="shrink-0 rounded-full bg-orbit-primary-soft px-1.5 py-0.5 text-[9px] font-bold text-orbit-primary">
                      활성
                    </span>
                  )}
                </div>
                <p className="truncate text-[10px] text-orbit-muted">
                  창 {windowNumbers.get(tab.windowId)} · {tab.url || '주소 없음'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleActivate(tab)}
                title="이 탭으로 이동"
                aria-label={`${tab.title} 탭으로 이동`}
                className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-orbit-muted opacity-70 transition hover:bg-orbit-surface hover:text-orbit-primary group-hover:opacity-100"
              >
                <LocateFixed size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
