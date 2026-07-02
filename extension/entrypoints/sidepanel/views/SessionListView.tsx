import { Loader2 } from 'lucide-react';
import { useSessions, usePendingSessionPoller } from '../hooks/useSessions';
import { useUIStore } from '../store/ui';
import { CurrentSessionCard } from '../components/CurrentSessionCard';
import { SessionCard } from '../components/SessionCard';
import { StatePlaceholder } from '../components/StatePlaceholder';

function ClusteringCard() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-orbit-primary/30 bg-orbit-surface p-3">
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
