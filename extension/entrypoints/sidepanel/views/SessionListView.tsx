import { useMemo } from 'react';
import { useSessions, usePendingSessionPoller } from '../hooks/useSessions';
import { groupSessionsByRecency } from '../../../lib/session-groups';
import { SessionRow } from '../components/SessionRow';
import { StatePlaceholder } from '../components/StatePlaceholder';
import { MergeSuggestionsSection } from '../components/MergeSuggestionsSection';

export function SessionListView() {
  usePendingSessionPoller();
  const { data: sessions, isLoading, isError } = useSessions();

  // 시간이 목록의 뼈대다 — 묶음이 리듬을 만들어야 행마다 굵기를 줄 필요가 없다.
  const groups = useMemo(() => groupSessionsByRecency(sessions ?? []), [sessions]);

  return (
    <div className="h-full overflow-y-auto">
      {/* 병합 제안은 목록보다 먼저 처리해야 목록이 흔들리지 않는다 */}
      <div className="empty:hidden px-4 pt-4">
        <MergeSuggestionsSection />
      </div>

      <div className="px-2 py-2">
        <StatePlaceholder
          loading={isLoading}
          error={isError}
          empty={!sessions?.length}
          emptyText="저장된 세션이 없어요"
        >
          <div className="space-y-4">
            {groups.map((group) => (
              <section key={group.key}>
                <p className="sticky top-0 z-10 bg-orbit-bg px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-orbit-muted">
                  {group.label}
                </p>
                {group.sessions.map((session) => (
                  <SessionRow key={session.id} session={session} />
                ))}
              </section>
            ))}
          </div>
        </StatePlaceholder>
      </div>
    </div>
  );
}
