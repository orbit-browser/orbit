import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search, X } from 'lucide-react';
import { activateOpenTab } from '../../../lib/chrome-bridge';
import { buildPreviewItems, type TabPreviewItem } from '../../../lib/tab-preview';
import { filterOpenTabs } from '../../../lib/tab-actions';
import { getTabThumbnails } from '../../../lib/tab-thumbnails';
import { Favicon } from '../components/Favicon';
import { Sheet } from '../components/control/Sheet';
import { useOpenTabs } from '../hooks/useTabs';
import { useUIStore } from '../store/ui';

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url || '주소 없음';
  }
}

/** 도메인마다 일정한 색을 뽑아, 아직 안 찍힌 탭의 표지를 만든다. */
const COVER_HUES = [12, 28, 200, 260, 150, 330, 45, 180];
function coverStyle(url: string) {
  let hash = 0;
  for (const char of url) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = COVER_HUES[hash % COVER_HUES.length];
  return {
    background: `linear-gradient(140deg, hsl(${hue} 58% 66%), hsl(${(hue + 26) % 360} 54% 50%))`,
  };
}

function coverInitial(url: string): string {
  return (hostOf(url).replace(/^m\./, '')[0] ?? '?').toUpperCase();
}

function PreviewCard({ tab, onOpen }: { tab: TabPreviewItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={tab.title}
      className={
        'group block w-full cursor-pointer overflow-hidden rounded-[18px] bg-orbit-surface text-left shadow-orbit-raised transition-all duration-200 hover:-translate-y-0.5 hover:shadow-orbit-card ' +
        (tab.active ? 'ring-2 ring-orbit-primary ring-offset-0' : '')
      }
    >
      {tab.image ? (
        <img
          src={tab.image}
          alt=""
          loading="lazy"
          className="block h-[104px] w-full bg-orbit-tile object-cover object-top"
        />
      ) : (
        <div
          style={coverStyle(tab.url)}
          className="flex h-[104px] w-full items-center justify-center text-3xl font-extrabold text-white/95"
          aria-hidden
        >
          {coverInitial(tab.url)}
        </div>
      )}

      <div className="flex items-center gap-2 px-2.5 py-2">
        <span className="h-4 w-4 shrink-0 overflow-hidden rounded bg-white">
          <Favicon pageUrl={tab.url} src={tab.favIconUrl} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11.5px] font-bold text-orbit-text">{tab.title}</span>
          <span className="block truncate text-[10px] text-orbit-muted">{hostOf(tab.url)}</span>
        </span>
        {tab.active && (
          <span className="shrink-0 rounded-full bg-orbit-primary-soft px-1.5 py-0.5 text-[9px] font-bold text-orbit-primary">
            현재
          </span>
        )}
      </div>
    </button>
  );
}

/**
 * 열린 탭 미리보기.
 *
 * 썸네일은 사용자가 그 탭을 볼 때 백그라운드가 조용히 찍어 둔 것이다
 * (`chrome.tabs.captureVisibleTab` 은 활성 탭만 찍을 수 있어 모든 탭을 한 번에 만들 수 없다).
 * 아직 없는 탭은 도메인 색으로 만든 표지 카드로 그린다.
 */
export function OpenTabsSheet() {
  const { data: tabs = [], isLoading, isError } = useOpenTabs();
  const showToast = useUIStore((state) => state.showToast);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // 썸네일은 탭이 바뀔 때마다 다시 읽는다 — 방금 찍힌 화면이 바로 반영되도록.
  const { data: thumbnails = {} } = useQuery({
    queryKey: ['orbit-tab-thumbnails', tabs.length],
    queryFn: getTabThumbnails,
    staleTime: 2_000,
  });

  const filtered = useMemo(() => filterOpenTabs(tabs, query), [tabs, query]);
  const cards = useMemo(() => buildPreviewItems(filtered, thumbnails), [filtered, thumbnails]);

  const windowGroups = useMemo(() => {
    const ids = [...new Set(tabs.map((tab) => tab.windowId))];
    const numbers = new Map(ids.map((windowId, index) => [windowId, index + 1]));
    const groups = new Map<number, TabPreviewItem[]>();
    for (const card of cards) {
      const list = groups.get(card.windowId);
      if (list) list.push(card);
      else groups.set(card.windowId, [card]);
    }
    return [...groups.entries()].map(([windowId, items]) => ({
      windowId,
      label: ids.length > 1 ? `창 ${numbers.get(windowId)}` : '열린 탭',
      items,
    }));
  }, [cards, tabs]);

  useEffect(() => {
    if (searching) inputRef.current?.focus();
  }, [searching]);

  function closeSearch() {
    setSearching(false);
    setQuery('');
  }

  async function open(card: TabPreviewItem) {
    try {
      await activateOpenTab({ id: card.id, windowId: card.windowId });
      showToast(`“${card.title}” 탭으로 이동했어요`);
    } catch {
      showToast('탭을 찾지 못했어요. 목록을 새로고침해 주세요.');
    }
  }

  return (
    <Sheet
      title="열린 탭"
      meta={query.trim() ? `${filtered.length}/${tabs.length}` : `${tabs.length}개`}
      actions={
        <button
          type="button"
          onClick={() => (searching ? closeSearch() : setSearching(true))}
          aria-label={searching ? '탭 검색 닫기' : '탭 검색'}
          aria-pressed={searching}
          className={
            'flex h-8 w-8 cursor-pointer items-center justify-center rounded-full transition ' +
            (searching
              ? 'bg-orbit-primary-soft text-orbit-primary'
              : 'text-orbit-muted hover:bg-orbit-tile hover:text-orbit-text')
          }
        >
          <Search size={15} />
        </button>
      }
      toolbar={
        searching ? (
          <div className="flex items-center gap-2 p-2.5">
            <div className="relative min-w-0 flex-1">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-orbit-muted"
              />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') closeSearch();
                }}
                placeholder="탭 제목이나 주소 찾기"
                aria-label="열린 탭 검색"
                className="h-9 w-full rounded-full border border-orbit-border bg-orbit-tile pl-9 pr-3 text-xs text-orbit-text outline-none transition focus:border-orbit-primary/60"
              />
            </div>
            <button
              type="button"
              onClick={closeSearch}
              aria-label="검색 닫기"
              className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-orbit-muted transition hover:bg-orbit-tile hover:text-orbit-text"
            >
              <X size={15} />
            </button>
          </div>
        ) : undefined
      }
    >
      {isLoading ? (
        <div className="flex h-32 items-center justify-center gap-2 text-xs text-orbit-muted">
          <Loader2 size={14} className="animate-spin" /> 열린 탭 확인 중…
        </div>
      ) : isError ? (
        <p className="p-8 text-center text-xs text-orbit-danger">열린 탭을 불러오지 못했어요.</p>
      ) : cards.length === 0 ? (
        <p className="p-8 text-center text-xs text-orbit-muted">
          {tabs.length === 0 ? '열린 웹 탭이 없어요.' : '검색과 일치하는 탭이 없어요.'}
        </p>
      ) : (
        <div className="space-y-3 p-3">
          {windowGroups.map((group) => (
            <section key={group.windowId} className="space-y-2">
              <h3 className="px-1 text-[11px] font-semibold text-orbit-muted">{group.label}</h3>
              <div className="grid grid-cols-2 gap-2">
                {group.items.map((card) => (
                  <PreviewCard key={card.id} tab={card} onOpen={() => void open(card)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </Sheet>
  );
}
