import { Layers, Loader2, Radio } from 'lucide-react';
import type { Session } from '../../../../lib/types';
import { WidgetTile } from './WidgetFrame';
import { useSaveSessionsClustered } from '../../hooks/useSessions';
import { useTabs } from '../../hooks/useTabs';
import { useSettingsStore } from '../../store/settings';
import { useUIStore } from '../../store/ui';

/**
 * 탐색 기록 수집 — macOS 의 Wi-Fi·Bluetooth 타일과 같다.
 * 타일을 누르면 켜지고 꺼지며, 상태는 "켬 / 끔" 한 단어로만 보여준다.
 */
export function CollectionWidget() {
  const enabled = useSettingsStore((s) => s.collectionEnabled);
  const setEnabled = useSettingsStore((s) => s.setCollectionEnabled);
  const showToast = useUIStore((s) => s.showToast);

  return (
    <WidgetTile
      icon={<Radio size={16} />}
      title="탐색 기록 수집"
      status={enabled ? '켬' : '끔'}
      active={enabled}
      ariaLabel={`탐색 기록 수집 ${enabled ? '끄기' : '켜기'}`}
      onClick={() => {
        setEnabled(!enabled);
        showToast(enabled ? '탐색 기록 수집을 껐어요' : '탐색 기록 수집을 켰어요');
      }}
    />
  );
}

/** 현재 작업 공간 — 누르면 열린 탭을 세션으로 저장한다. */
export function WorkspaceWidget() {
  const { data: tabs = [], isLoading } = useTabs();
  const showToast = useUIStore((s) => s.showToast);
  const isClustering = useUIStore((s) => s.isClustering);
  const startClustering = useUIStore((s) => s.startClustering);
  const stopClustering = useUIStore((s) => s.stopClustering);
  const { mutate: saveClustered } = useSaveSessionsClustered();

  function handleSave() {
    if (isClustering) return;
    if (!tabs.length) {
      showToast('저장할 탭이 없어요');
      return;
    }
    startClustering();
    saveClustered(tabs, {
      onSuccess: (sessions: Session[]) => {
        stopClustering();
        showToast(
          sessions.length > 1
            ? `${sessions.length}개 세션으로 분류됐어요`
            : `${tabs.length}개 탭을 세션으로 저장했어요`,
        );
      },
      onError: () => {
        stopClustering();
        showToast('세션 저장에 실패했어요. 백엔드 서버를 확인해 주세요.');
      },
    });
  }

  return (
    <WidgetTile
      icon={isClustering ? <Loader2 size={16} className="animate-spin" /> : <Layers size={16} />}
      title="세션 저장"
      status={isClustering ? '분류 중' : isLoading ? '확인 중' : `${tabs.length}개 탭`}
      active={!isClustering && tabs.length > 0}
      disabled={isClustering}
      ariaLabel="현재 작업 공간을 세션으로 저장"
      onClick={handleSave}
    />
  );
}
