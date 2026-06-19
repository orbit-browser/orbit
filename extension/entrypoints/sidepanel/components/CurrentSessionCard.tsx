import { ChevronRight, Layers } from 'lucide-react';
import { useTabs } from '../hooks/useTabs';

// 현재 창에 열린 실제 탭 수(chrome.tabs)를 보여주는 카드 — 실데이터 연동 지점.
export function CurrentSessionCard() {
  const { data: tabs, isLoading } = useTabs();
  const count = tabs?.length ?? 0;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-orbit-border bg-orbit-surface p-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orbit-primary-soft text-orbit-primary">
        <Layers size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">현재 작업 공간</p>
        <p className="text-xs text-orbit-muted">
          {isLoading ? '열린 탭 확인 중…' : `${count}개 탭이 열려 있어요 · 지금`}
        </p>
      </div>
      <ChevronRight size={18} className="text-orbit-muted" />
    </div>
  );
}
