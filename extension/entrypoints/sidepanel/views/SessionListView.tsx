import { useMemo, useState } from 'react';
import { Share2 } from 'lucide-react';
import { useSessions, usePendingSessionPoller } from '../hooks/useSessions';
import { useWorkspaceSessions } from '../hooks/useWorkspaces';
import { groupSessionsByRecency } from '../../../lib/session-groups';
import { useActiveWorkspace } from '../../../lib/useWorkspaces';
import { SessionRow } from '../components/SessionRow';
import { StatePlaceholder } from '../components/StatePlaceholder';
import { MergeSuggestionsSection } from '../components/MergeSuggestionsSection';
import { ShareMySessionsDialog } from '../components/team/ShareMySessionsDialog';
import type { Workspace } from '../../../lib/types';

export function SessionListView() {
  const { scopeId, active } = useActiveWorkspace();
  return scopeId ? <TeamSessionList workspaceId={scopeId} team={active} /> : <PersonalSessionList />;
}

function PersonalSessionList() {
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

/** 팀에 공유된 세션. 읽기 전용이다 — 이름·삭제·병합은 공유한 사람의 개인 화면에서 한다. */
function TeamSessionList({ workspaceId, team }: { workspaceId: string; team: Workspace | null }) {
  const { data: sessions, isLoading, isError, refetch } = useWorkspaceSessions(workspaceId);
  const groups = useMemo(() => groupSessionsByRecency(sessions ?? []), [sessions]);
  const [sharing, setSharing] = useState(false);

  return (
    <div className="h-full overflow-y-auto">
      {/* 팀 화면의 다음 행동 — 팀을 채우는 길은 내 세션을 공유하는 것이다. */}
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <p className="min-w-0 truncate text-[11px] text-orbit-muted">{team?.name ?? '팀'}에 공유된 세션</p>
        <button
          type="button"
          disabled={!team}
          onClick={() => setSharing(true)}
          className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-orbit-primary px-2.5 py-1 text-[11px] font-semibold text-white transition hover:brightness-95 disabled:opacity-50"
        >
          <Share2 size={11} /> 내 세션 공유하기
        </button>
      </div>
      {sharing && team && <ShareMySessionsDialog workspace={team} onClose={() => setSharing(false)} />}
      <div className="px-2 py-2">
        <StatePlaceholder
          loading={isLoading}
          error={isError}
          onRetry={() => void refetch()}
          empty={!sessions?.length}
          emptyText="팀에 공유된 세션이 없어요. 위의 ‘내 세션 공유하기’로 첫 세션을 올려 보세요."
        >
          <div className="space-y-4">
            {groups.map((group) => (
              <section key={group.key}>
                <p className="sticky top-0 z-10 bg-orbit-bg px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-orbit-muted">
                  {group.label}
                </p>
                {group.sessions.map((session) => (
                  <SessionRow key={session.id} session={session} sharedBy={session.sharedBy} />
                ))}
              </section>
            ))}
          </div>
        </StatePlaceholder>
      </div>
    </div>
  );
}
