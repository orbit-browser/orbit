import { Plus } from 'lucide-react';
import { useTabs } from '../hooks/useTabs';
import { useUIStore } from '../store/ui';

export function SaveSessionButton() {
  const { data: tabs } = useTabs();
  const showToast = useUIStore((s) => s.showToast);

  return (
    <button
      type="button"
      onClick={() => showToast(`현재 ${tabs?.length ?? 0}개 탭을 새 세션으로 저장 (mock)`)}
      className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-orbit-primary py-2.5 text-sm font-semibold text-white transition hover:brightness-95"
    >
      <Plus size={16} />새 세션 저장
    </button>
  );
}
