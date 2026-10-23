import { Check, X } from 'lucide-react';
import type { Workspace } from '../../../../lib/types';
import { useSessions } from '../../hooks/useSessions';
import { useWorkspaceMutations } from '../../hooks/useWorkspaces';
import { useUIStore } from '../../store/ui';

/**
 * 팀 화면에서 바로 내 세션을 이 팀에 공유한다. 팀 화면에는 내 세션이 보이지 않아서, 공유하려면
 * 개인으로 돌아가 세션마다 메뉴를 열어야 했다. 공유는 즉시 반영한다(ShareSessionDialog 와 같다).
 */
export function ShareMySessionsDialog({ workspace, onClose }: { workspace: Workspace; onClose: () => void }) {
  const { data: sessions, isLoading, isError, refetch } = useSessions();
  const { share } = useWorkspaceMutations();
  const showToast = useUIStore((s) => s.showToast);

  function shareOne(sessionId: string) {
    share.mutate(
      { workspaceId: workspace.id, sessionIds: [sessionId] },
      {
        onSuccess: (result) =>
          showToast(result.shared.includes(sessionId) ? `${workspace.name}에 공유했어요` : '이 세션은 공유할 수 없어요'),
        onError: () => showToast('공유하지 못했어요'),
      },
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${workspace.name}에 내 세션 공유`}
      onClick={onClose}
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-3"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="animate-bouncy flex max-h-[80vh] w-full max-w-sm flex-col gap-3 rounded-orbit-card border border-orbit-border bg-orbit-surface p-4 shadow-orbit-overlay"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-bold text-orbit-text">{workspace.name}에 내 세션 공유</p>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            aria-label="닫기"
            className="cursor-pointer rounded-md p-1 text-orbit-muted transition hover:bg-orbit-bg hover:text-orbit-text"
          >
            <X size={14} />
          </button>
        </div>
        <p className="rounded-md bg-orbit-bg p-2 text-[11px] leading-relaxed text-orbit-muted">
          팀원은 공유한 세션의 제목·요약·페이지 목록을 볼 수 있고, 페이지 본문 일부가 팀 Ask 답변의 근거로 쓰여요.
        </p>
        <div className="min-h-0 overflow-y-auto">
          {isLoading ? (
            <p className="py-6 text-center text-xs text-orbit-muted">내 세션을 불러오는 중…</p>
          ) : isError ? (
            <p className="py-6 text-center text-xs text-orbit-danger" role="alert">
              내 세션을 불러오지 못했어요.{' '}
              <button type="button" onClick={() => void refetch()} className="cursor-pointer font-semibold underline">
                다시 시도
              </button>
            </p>
          ) : !sessions?.length ? (
            <p className="py-6 text-center text-xs text-orbit-muted">
              아직 내 세션이 없어요. 개인 화면에서 수집을 켜면 세션이 생겨요.
            </p>
          ) : (
            <ul className="divide-y divide-orbit-border">
              {sessions.map((session) => {
                const shared = session.sharedWorkspaceIds?.includes(workspace.id) ?? false;
                return (
                  <li key={session.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="min-w-0 truncate text-xs text-orbit-text">{session.title}</span>
                    {shared ? (
                      <span className="flex shrink-0 items-center gap-1 px-2 text-[11px] font-semibold text-orbit-muted">
                        <Check size={11} /> 공유됨
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={share.isPending}
                        onClick={() => shareOne(session.id)}
                        className="shrink-0 cursor-pointer rounded-md bg-orbit-primary px-2 py-1 text-[11px] font-semibold text-white transition hover:brightness-95 disabled:opacity-50"
                      >
                        공유
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
