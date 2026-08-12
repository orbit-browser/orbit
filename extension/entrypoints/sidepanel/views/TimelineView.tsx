import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { StatePlaceholder } from '../components/StatePlaceholder';
import { CollectionOptInNotice } from '../components/timeline/CollectionOptInNotice';
import { TimelineDateHeader } from '../components/timeline/TimelineDateHeader';
import { TimelineItem } from '../components/timeline/TimelineItem';
import { useDeleteTimelineEntry, useTimeline } from '../hooks/useTimeline';
import { useSyncStatus } from '../hooks/useSyncStatus';
import { useSettingsStore } from '../store/settings';
import { useUIStore } from '../store/ui';

// 사이드패널 기본 화면 — 최근 방문을 시간 역순으로 보여주는 "다시 찾기" 화면.
// 목록의 원천은 로컬 큐(48시간 보관)이며 서버 조회는 세션 배지를 붙이는 용도다.
// 계약 근거: docs/IA.md "타임라인", docs/target-architecture.md §7.
export function TimelineView() {
  const [query, setQuery] = useState('');
  // 필터는 평소 접혀 있다 — 세로는 목록에 쓰고, 필요할 때 헤더의 돋보기로 편다.
  const [filterOpen, setFilterOpen] = useState(false);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const { groups, isLoading, isError, isEmpty, isFilteredOut } = useTimeline(query);
  const { mutate: deleteEntry } = useDeleteTimelineEntry();
  const { data: syncStatus } = useSyncStatus();
  const collectionEnabled = useSettingsStore((s) => s.collectionEnabled);
  const showToast = useUIStore((s) => s.showToast);

  // 입력창은 접혀 있을 때도 마운트돼 있어야 높이 전환이 이어진다 — autoFocus 가 못 걸리므로
  // 열림 전환에서 직접 포커스를 준다.
  useEffect(() => {
    if (filterOpen) filterInputRef.current?.focus({ preventScroll: true });
  }, [filterOpen]);

  // 닫을 때 입력을 비운다 — 접힌 채로 필터가 걸려 있으면 목록이 왜 짧은지 알 수 없다.
  function closeFilter() {
    setQuery('');
    setFilterOpen(false);
    filterInputRef.current?.blur();
  }

  // 수집이 꺼졌는데 기록도 없으면 목록 대신 안내가 화면 전체를 쓴다.
  if (!collectionEnabled && isEmpty) {
    return (
      <div className="h-full overflow-y-auto">
        <CollectionOptInNotice />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {!collectionEnabled && (
        <div className="shrink-0 px-3 pt-2.5">
          <CollectionOptInNotice compact />
        </div>
      )}

      {/*
        펼치기 애니메이션 — grid-template-rows 를 0fr↔1fr 로 전환한다.
        높이를 재서 px 로 넣지 않아도 되고, 입력창 높이가 바뀌어도 그대로 맞는다.
        결과가 0건이면 날짜 헤더가 사라지므로 입력창은 목록 밖에 둬야 계속 고칠 수 있다.
      */}
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
                aria-label="최근 기록 걸러내기"
                // 접혀 있을 때는 화면에 없는 것과 같아야 한다 — Tab 순회와 스크린리더에서 뺀다.
                tabIndex={filterOpen ? 0 : -1}
                aria-hidden={!filterOpen}
                className="h-8 w-full rounded-lg border border-orbit-border/70 bg-orbit-surface pl-8 pr-8 text-xs text-orbit-text outline-none transition focus:border-orbit-primary/60"
              />
              <button
                type="button"
                onClick={closeFilter}
                aria-label="필터 닫기"
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

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <StatePlaceholder
          loading={isLoading}
          error={isError}
          empty={isEmpty || isFilteredOut}
          emptyText={
            isFilteredOut
              ? `“${query.trim()}” 와 일치하는 기록이 없어요`
              : '오늘의 탐색이 여기에 기록됩니다'
          }
        >
          <div className="space-y-3">
            {groups.map((group, index) => (
              <section key={group.dateKey}>
                <TimelineDateHeader
                  label={group.label}
                  // 동기화 현황은 "지금 상태"라 맨 위 그룹에만 붙인다.
                  status={
                    index === 0
                      ? {
                          pendingCount: syncStatus?.pendingCount ?? 0,
                          lastSyncAt: syncStatus?.lastSyncAt ?? null,
                        }
                      : undefined
                  }
                  onOpenFilter={
                    index === 0 && !filterOpen ? () => setFilterOpen(true) : undefined
                  }
                />
                <div className="space-y-0.5">
                  {group.entries.map((entry) => (
                    <TimelineItem
                      key={entry.id}
                      event={entry}
                      badge={entry.badge}
                      onDelete={() =>
                        deleteEntry(entry, {
                          onSuccess: () => showToast('삭제했어요'),
                          onError: () => showToast('삭제에 실패했어요. 다시 시도해 주세요.'),
                        })
                      }
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </StatePlaceholder>
      </div>
    </div>
  );
}
