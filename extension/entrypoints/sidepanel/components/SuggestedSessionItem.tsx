import { FileText } from 'lucide-react';
import type { Session } from '../../../lib/types';
import { useUIStore } from '../store/ui';

export function SuggestedSessionItem({ session }: { session: Session }) {
  const openSession = useUIStore((s) => s.openSession);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openSession(session.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') openSession(session.id);
      }}
      className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-orbit-bg"
    >
      <FileText size={16} className="shrink-0 text-orbit-muted" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{session.title}</p>
        <p className="text-xs text-orbit-muted">
          {session.tabs.length}개 탭 · {session.timeLabel}
        </p>
      </div>
    </div>
  );
}
