import { useSession, useSessions } from '../hooks/useSessions';
import { useUIStore } from '../store/ui';
import { SummaryPanel } from '../components/SummaryPanel';
import { StatePlaceholder } from '../components/StatePlaceholder';

export function SummaryView() {
  const selectedId = useUIStore((s) => s.selectedSessionId);
  const { data: sessions, isLoading } = useSessions();
  const { data: selected } = useSession(selectedId);

  // 선택된 세션이 없으면 첫 세션을 기본으로 보여줍니다.
  const session = selected ?? sessions?.[0];

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold text-orbit-muted">세션 요약 (AI 요약)</p>
        {session && <p className="mt-0.5 truncate text-sm font-semibold">{session.title}</p>}
      </div>

      <StatePlaceholder
        loading={isLoading}
        empty={!session}
        emptyText="요약할 세션이 없어요"
      >
        {session && <SummaryPanel summary={session.summary} />}
      </StatePlaceholder>
    </div>
  );
}
