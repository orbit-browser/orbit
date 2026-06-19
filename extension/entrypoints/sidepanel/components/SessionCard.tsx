import { FileText } from 'lucide-react';
import type { Session } from '../../../lib/types';
import { useUIStore } from '../store/ui';
import { OverflowMenu } from './OverflowMenu';

export function SessionCard({ session }: { session: Session }) {
  const openSession = useUIStore((s) => s.openSession);
  const showToast = useUIStore((s) => s.showToast);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openSession(session.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') openSession(session.id);
      }}
      className="flex cursor-pointer items-center gap-3 rounded-xl border border-orbit-border bg-orbit-surface p-3 transition hover:border-orbit-primary/40 hover:shadow-sm"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orbit-bg text-orbit-muted">
        <FileText size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{session.title}</p>
        <p className="text-xs text-orbit-muted">
          {session.tabs.length}개 탭 · {session.timeLabel}
        </p>
      </div>
      <OverflowMenu
        actions={[
          { label: '세션 열기', onClick: () => showToast('세션 복원 (mock)') },
          { label: '요약 보기', onClick: () => openSession(session.id) },
          { label: '삭제', onClick: () => showToast('삭제 (mock)'), danger: true },
        ]}
      />
    </div>
  );
}
