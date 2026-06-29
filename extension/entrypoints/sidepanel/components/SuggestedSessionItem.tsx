import { ExternalLink, RotateCcw } from 'lucide-react';
import type { Session } from '../../../lib/types';
import { useUIStore } from '../store/ui';
import { openTabs } from '../../../lib/chrome-bridge';

export function SuggestedSessionItem({ session, rank }: { session: Session; rank: number }) {
  const openSession = useUIStore((s) => s.openSession);
  const showToast = useUIStore((s) => s.showToast);

  async function handleRestore(e: React.MouseEvent) {
    e.stopPropagation();
    await openTabs(session.tabs.map((t) => t.url));
    showToast(`${session.tabs.length}개 탭을 복원했어요`);
  }

  const previewTabs = session.tabs.slice(0, 3);
  const overflow = session.tabs.length - previewTabs.length;

  return (
    <div className="rounded-xl border border-orbit-border bg-orbit-surface p-4 space-y-3">
      {/* 헤더 */}
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 text-[11px] font-semibold text-orbit-primary opacity-60">
          #{rank}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-orbit-text">{session.title}</p>
          <p className="mt-0.5 text-xs text-orbit-muted">
            {session.timeLabel} · {session.tabs.length}개 탭
          </p>
        </div>
      </div>

      {/* AI 요약 개요 */}
      {session.summary.overview && (
        <p className="line-clamp-2 text-xs leading-relaxed text-orbit-muted">
          {session.summary.overview}
        </p>
      )}

      {/* 탭 미리보기 */}
      <ul className="space-y-1">
        {previewTabs.map((tab) => (
          <li key={tab.id} className="flex items-center gap-1.5 min-w-0">
            <span className="shrink-0 h-1 w-1 rounded-full bg-orbit-muted opacity-50" />
            <span className="truncate text-xs text-orbit-muted">{tab.title}</span>
          </li>
        ))}
        {overflow > 0 && (
          <li className="text-xs text-orbit-muted opacity-60">외 {overflow}개 탭</li>
        )}
      </ul>

      {/* 액션 */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleRestore}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-orbit-primary py-2 text-xs font-semibold text-white transition hover:brightness-95"
        >
          <RotateCcw size={13} />
          탭 복원하기
        </button>
        <button
          type="button"
          onClick={() => openSession(session.id)}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-orbit-border px-3 py-2 text-xs font-medium text-orbit-muted transition hover:border-orbit-text/30 hover:text-orbit-text"
        >
          <ExternalLink size={13} />
          상세
        </button>
      </div>
    </div>
  );
}
