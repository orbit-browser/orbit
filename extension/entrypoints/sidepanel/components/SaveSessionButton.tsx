import { Plus } from 'lucide-react';
import { useTabs } from '../hooks/useTabs';
import { useUIStore } from '../store/ui';
import { useSaveSessionsClustered } from '../hooks/useSessions';
import type { Session } from '../../../lib/types';

export function SaveSessionButton() {
  const { data: tabs = [] } = useTabs();
  const showToast = useUIStore((s) => s.showToast);
  const isClustering = useUIStore((s) => s.isClustering);
  const startClustering = useUIStore((s) => s.startClustering);
  const stopClustering = useUIStore((s) => s.stopClustering);
  const { mutate: saveClustered } = useSaveSessionsClustered();

  function handleSave() {
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
    <button
      type="button"
      onClick={handleSave}
      disabled={isClustering}
      className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-orbit-primary py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-60"
    >
      <Plus size={16} />
      새 세션 저장
    </button>
  );
}
