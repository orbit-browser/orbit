import { Trash2 } from 'lucide-react';
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
      className="group relative flex cursor-pointer flex-col rounded-2xl border border-orbit-border bg-orbit-surface p-4 transition hover:border-orbit-primary/30 hover:shadow-sm"
    >
      <button
        type="button"
        onClick={handleDelete}
        className="absolute right-3 top-3 rounded-lg p-1 text-orbit-muted opacity-0 transition hover:text-red-500 group-hover:opacity-100"
        aria-label="세션 삭제"
      >
        <Trash2 size={14} />
      </button>

      <p className="mb-1.5 text-xs text-orbit-muted">{session.timeLabel}</p>
      <p className="mb-2 pr-6 font-semibold leading-snug text-orbit-text line-clamp-2">
        {session.title}
      </p>
      <p className="flex-1 text-[13px] leading-relaxed text-orbit-muted line-clamp-3">
        {session.summary.overview}
      </p>

      {session.summary.highlights?.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {session.summary.highlights.slice(0, 2).map((h, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-orbit-muted">
              <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-orbit-primary" />
              <span className="line-clamp-1">{h}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-xs text-orbit-muted/60">{session.tabs.length}개 탭</p>
    </div>
  );
}
