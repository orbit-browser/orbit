import { Sparkles } from 'lucide-react';
import { useSessions, usePendingSessionPoller } from '../hooks/useSessions';
import { useUIStore } from '../store/ui';
import { CurrentSessionCard } from '../components/CurrentSessionCard';
import { SaveSessionButton } from '../components/SaveSessionButton';
import { SessionCard } from '../components/SessionCard';
import { StatePlaceholder } from '../components/StatePlaceholder';

export function SessionListView() {
  usePendingSessionPoller();
  const { data: sessions, isLoading, isError } = useSessions();
  const setView = useUIStore((s) => s.setView);

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <p className="text-xs font-semibold text-orbit-muted">현재 세션</p>
        <CurrentSessionCard />
        <SaveSessionButton />
      </section>

      <section className="space-y-2">
        <p className="text-xs font-semibold text-orbit-muted">세션 목록</p>
        <StatePlaceholder
          loading={isLoading}
          error={isError}
          empty={!sessions?.length}
          emptyText="저장된 세션이 없어요"
        >
          <div className="space-y-2">
            {sessions?.map((session) => (
              <SessionCard key={session.id} session={session} />
            ))}
          </div>
        </StatePlaceholder>
      </section>

      <button
        type="button"
        onClick={() => setView('search')}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-orbit-border py-2.5 text-sm font-medium text-orbit-text transition hover:bg-orbit-bg"
      >
        <Sparkles size={15} className="text-orbit-primary" />
        자연어로 세션 복원하기
      </button>
    </div>
  );
}
