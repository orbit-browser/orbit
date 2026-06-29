import { Loader2, Sparkles } from 'lucide-react';
import { useSessions, usePendingSessionPoller } from '../hooks/useSessions';
import { useUIStore } from '../store/ui';
import { CurrentSessionCard } from '../components/CurrentSessionCard';
import { SaveSessionButton } from '../components/SaveSessionButton';
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
  const setView = useUIStore((s) => s.setView);
  const isClustering = useUIStore((s) => s.isClustering);

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <p className="text-xs font-semibold text-orbit-muted">현재 세션</p>
        <CurrentSessionCard />
        <SaveSessionButton />
      </section>

      <button
        type="button"
        onClick={() => setView('search')}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-orbit-border py-2.5 text-sm font-medium text-orbit-text transition hover:bg-orbit-bg"
      >
        <Sparkles size={15} className="text-orbit-primary" />
        자연어로 세션 복원하기
      </button>

      <section className="space-y-2">
        <p className="text-xs font-semibold text-orbit-muted">세션 목록</p>
        <StatePlaceholder
          loading={isLoading && !isClustering}
          error={isError}
          empty={!isClustering && !sessions?.length}
          emptyText="저장된 세션이 없어요"
        >
          <div className="space-y-2">
            {isClustering && <ClusteringCard />}
            {sessions?.map((session) => (
              <SessionCard key={session.id} session={session} />
            ))}
          </div>
        </StatePlaceholder>
      </section>
    </div>
  );
}
