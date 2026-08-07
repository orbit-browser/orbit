import { useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { useSessions, usePendingSessionPoller } from '../hooks/useSessions';
import { useUIStore } from '../store/ui';
import { CurrentSessionCard } from '../components/CurrentSessionCard';
import { SessionCard } from '../components/SessionCard';
import { StatePlaceholder } from '../components/StatePlaceholder';
import { MergeSuggestionsSection } from '../components/MergeSuggestionsSection';
import { OpenTabsPanel } from '../components/OpenTabsPanel';

function ClusteringCard() {
  return (
    <div className="flex items-center gap-3 rounded-orbit-card border border-orbit-primary/30 bg-orbit-surface p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orbit-bg">
        <Loader2 size={18} className="animate-spin text-orbit-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-orbit-primary">주제 분류 중…</p>
        <p className="text-xs text-orbit-muted">탭을 주제별로 묶는 중이에요</p>
      </div>
    </div>
  );
}

export function SessionListView() {
  const [openTabsExpanded, setOpenTabsExpanded] = useState(false);
  usePendingSessionPoller();
  const { data: sessions, isLoading, isError } = useSessions();
  const isClustering = useUIStore((s) => s.isClustering);

  return (
    <div className="space-y-5 p-4 overflow-y-auto h-full">
      <section className="space-y-2">
        <p className="text-xs font-semibold text-orbit-muted">현재 세션</p>
        <CurrentSessionCard />
      </section>

      <section className="space-y-2">
        <button
          type="button"
          aria-expanded={openTabsExpanded}
          aria-controls="open-tabs-panel"
          onClick={() => setOpenTabsExpanded((expanded) => !expanded)}
          className="flex w-full cursor-pointer items-center justify-between rounded-lg px-1 py-1 text-xs font-semibold text-orbit-muted transition hover:text-orbit-text"
        >
          <span>열린 탭 찾기 · 북마크</span>
          <ChevronDown
            size={15}
            className={`transition-transform ${openTabsExpanded ? 'rotate-180' : ''}`}
          />
        </button>
        {openTabsExpanded && (
          <div id="open-tabs-panel">
            <OpenTabsPanel />
          </div>
        )}
      </section>

      <MergeSuggestionsSection />

      <section className="space-y-2">
        <p className="text-xs font-semibold text-orbit-muted">저장된 세션</p>
        <StatePlaceholder
          loading={isLoading && !isClustering}
          error={isError}
          empty={!isClustering && !sessions?.length}
          emptyText="저장된 세션이 없어요"
        >
          <div className="grid grid-cols-1 min-[500px]:grid-cols-2 min-[750px]:grid-cols-3 gap-3">
            {isClustering && (
              <div className="col-span-full">
                <ClusteringCard />
              </div>
            )}
            {sessions?.map((session) => (
              <SessionCard key={session.id} session={session} />
            ))}
          </div>
        </StatePlaceholder>
      </section>
    </div>
  );
}
