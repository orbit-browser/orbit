import { Layers, Plus, Loader2 } from 'lucide-react';
import { useTabs } from '../hooks/useTabs';
import { useUIStore } from '../store/ui';
import { useSaveSessionsClustered } from '../hooks/useSessions';
import type { Session } from '../../../lib/types';

export function CurrentSessionCard() {
  const { data: tabs = [], isLoading: isTabsLoading } = useTabs();
  const count = tabs.length;

  const showToast = useUIStore((s) => s.showToast);
  const isClustering = useUIStore((s) => s.isClustering);
  const startClustering = useUIStore((s) => s.startClustering);
  const stopClustering = useUIStore((s) => s.stopClustering);
  const { mutate: saveClustered } = useSaveSessionsClustered();

  function handleSave(e: React.MouseEvent) {
    e.stopPropagation();
    if (!tabs.length) {
      showToast('저장할 탭이 없어요');
      return;
    }
    if (isClustering) return;

    startClustering();

    saveClustered(tabs, {
      onSuccess: (sessions: Session[]) => {
        stopClustering();
        const msg =
          sessions.length > 1
            ? `${sessions.length}개 세션으로 분류됐어요`
            : `${tabs.length}개 탭을 세션으로 저장했어요`;
        showToast(msg);
      },
      onError: () => {
        stopClustering();
        showToast('세션 저장에 실패했어요. 백엔드 서버를 확인해 주세요.');
      },
    });
  }

  return (
    <div className="flex items-center gap-3 rounded-orbit-card border border-orbit-border bg-orbit-surface p-3.5 shadow-orbit-raised">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orbit-primary-soft text-orbit-primary">
        <Layers size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-orbit-text">현재 작업 공간</p>
        <p className="text-xs text-orbit-muted mt-0.5">
          {isTabsLoading ? '열린 탭 확인 중…' : `${count}개 탭이 열려 있어요`}
        </p>
      </div>
      <button
        type="button"
        onClick={handleSave}
        disabled={isClustering || count === 0}
        className="flex items-center gap-1.5 rounded-lg bg-orbit-primary px-3 py-1.5 text-xs font-bold text-white transition hover:brightness-95 disabled:opacity-50 cursor-pointer shrink-0"
      >
        {isClustering ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <Plus size={13} />
        )}
        세션 저장
      </button>
    </div>
  );
}
