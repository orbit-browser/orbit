import { FileText, Trash2 } from 'lucide-react';
import type { Session } from '../lib/types';
import { useUIStore } from '../store/ui';
import { useDeleteSession } from '../hooks/useSessions';

export function SessionCard({ session }: { session: Session }) {
  const openSession = useUIStore((s) => s.openSession);
  const showToast = useUIStore((s) => s.showToast);
  const { mutate: deleteSession } = useDeleteSession();

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`"${session.title}" 세션을 삭제할까요?`)) return;
    deleteSession(session.id, {
      onSuccess: () => showToast('세션을 삭제했어요'),
    });
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openSession(session.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') openSession(session.id);
      }}
      className="group flex cursor-pointer items-start gap-3 rounded-xl border border-orbit-border bg-orbit-surface p-4 transition hover:border-orbit-primary/40 hover:shadow-sm"
    >
      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orbit-bg text-orbit-muted">
        <FileText size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{session.title}</p>
        <p className="mt-0.5 line-clamp-2 text-sm text-orbit-muted">{session.summary.overview}</p>
        <p className="mt-1.5 text-xs text-orbit-muted">
          {session.tabs.length}개 탭 · {session.timeLabel}
        </p>
      </div>
      <button
        type="button"
        onClick={handleDelete}
        className="shrink-0 rounded p-1 text-orbit-muted opacity-0 transition hover:text-red-500 group-hover:opacity-100"
        aria-label="세션 삭제"
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}
