import { Plus } from 'lucide-react';
import { useTabs } from '../hooks/useTabs';
import { useUIStore } from '../store/ui';
import { useSaveSession } from '../hooks/useSessions';
import type { Session, TabItem } from '../../../lib/types';

function generateTitle(tabs: TabItem[]): string {
  if (tabs.length === 0) return '새 세션';
  if (tabs.length === 1) return tabs[0].title.slice(0, 40);
  return `${tabs[0].title.slice(0, 30)} 외 ${tabs.length - 1}개`;
}

function formatTimeLabel(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function SaveSessionButton() {
  const { data: tabs = [] } = useTabs();
  const showToast = useUIStore((s) => s.showToast);
  const { mutate: saveSession, isPending } = useSaveSession();

  function handleSave() {
    if (!tabs.length) {
      showToast('저장할 탭이 없어요');
      return;
    }
    const now = new Date();
    const nowIso = now.toISOString();
    const session: Session = {
      id: `session_${Date.now()}`,
      title: generateTitle(tabs),
      tabs,
      createdAt: nowIso,
      updatedAt: nowIso,
      timeLabel: formatTimeLabel(now),
      summary: {
        overview: `${tabs.length}개 탭으로 구성된 세션`,
        highlights: [],
      },
    };
    saveSession(session, {
      onSuccess: () => showToast(`${tabs.length}개 탭을 세션으로 저장했어요`),
    });
  }

  return (
    <button
      type="button"
      onClick={handleSave}
      disabled={isPending}
      className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-orbit-primary py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-60"
    >
      <Plus size={16} />새 세션 저장
    </button>
  );
}
