import { X } from 'lucide-react';
import type { Session, Workspace } from '../../../../lib/types';
import { useWorkspaces } from '../../../../lib/useWorkspaces';
import { useWorkspaceMutations } from '../../hooks/useWorkspaces';
import { useUIStore } from '../../store/ui';

/**
 * 세션을 팀에 공유·해제한다. 팀마다 즉시 반영한다 — "저장" 단계를 두면 무엇이 이미 공유됐는지
 * 화면과 서버가 어긋나는 순간이 생긴다.
 *
 * 공유는 사본이 아니라 원본을 가리킨다. 이후 이 세션에 붙는 페이지도 팀에 보이므로 그 사실을
 * 버튼보다 먼저 보여 준다.
 */
export function ShareSessionDialog({ session, onClose }: { session: Session; onClose: () => void }) {
  const { data: workspaces = [] } = useWorkspaces();
  const { share, unshare } = useWorkspaceMutations();
  const showToast = useUIStore((s) => s.showToast);
  const sharedIds = new Set(session.sharedWorkspaceIds ?? []);
  const busy = share.isPending || unshare.isPending;

  function toggle(workspace: Workspace) {
    if (sharedIds.has(workspace.id)) {
      unshare.mutate(
        { workspaceId: workspace.id, sessionId: session.id },
        {
          onSuccess: () => showToast(`${workspace.name}에서 공유를 해제했어요`),
          onError: () => showToast('공유를 해제하지 못했어요'),
        },
      );
      return;
    }
    share.mutate(
      { workspaceId: workspace.id, sessionIds: [session.id] },
      {
        onSuccess: (result) =>
          showToast(
            result.shared.includes(session.id)
              ? `${workspace.name}에 공유했어요`
              : '이 세션은 공유할 수 없어요',
          ),
        onError: () => showToast('공유하지 못했어요'),
      },
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="팀에 공유"
      onClick={onClose}
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-3"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-sm space-y-3 rounded-orbit-card border border-orbit-border bg-orbit-surface p-4 shadow-orbit-overlay"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-bold text-orbit-text">팀에 공유</p>
          {/* 처음부터 시트 안에 초점을 둬야 Esc 로 바로 닫힌다. */}
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
        <p className="truncate text-xs font-medium text-orbit-text">{session.title}</p>
        <p className="rounded-md bg-orbit-bg p-2 text-[11px] leading-relaxed text-orbit-muted">
          팀원은 이 세션의 제목·요약·페이지 목록을 볼 수 있고, 페이지 본문 일부가 팀 Ask 답변의
          근거로 쓰여요. 공유한 뒤 이 세션에 추가되는 페이지도 팀에 보여요.
        </p>
        {workspaces.length === 0 ? (
          <p className="py-2 text-center text-xs text-orbit-muted">
            아직 팀이 없어요. 설정에서 팀을 만들거나 초대 코드로 참여해 주세요.
          </p>
        ) : (
          <ul className="divide-y divide-orbit-border">
            {workspaces.map((workspace) => {
              const shared = sharedIds.has(workspace.id);
              return (
                <li key={workspace.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden
                      style={{ backgroundColor: workspace.hue }}
                      className="h-2 w-2 shrink-0 rounded-full"
                    />
                    <span className="truncate text-sm text-orbit-text">{workspace.name}</span>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => toggle(workspace)}
                    className={
                      'shrink-0 cursor-pointer rounded-md px-2 py-1 text-[11px] font-semibold transition disabled:opacity-50 ' +
                      (shared
                        ? 'text-orbit-muted hover:bg-orbit-danger-soft hover:text-orbit-danger'
                        : 'bg-orbit-primary text-white hover:brightness-95')
                    }
                  >
                    {shared ? '공유 해제' : '공유'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
