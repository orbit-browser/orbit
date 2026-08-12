import { ChevronLeft, Loader2, RefreshCw, Settings, Trash2, X } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAskConversation } from '../../shared/hooks/useAskConversation';
import { triggerManualSync } from '../hooks/useSyncStatus';
import { useUIStore } from '../store/ui';

export function TopNavBar() {
  const activeView = useUIStore((s) => s.activeView);
  const askOpen = useUIStore((s) => s.askOpen);
  const closeAsk = useUIStore((s) => s.closeAsk);
  const setView = useUIStore((s) => s.setView);
  const showToast = useUIStore((s) => s.showToast);
  const { turns, startNewConversation } = useAskConversation();
  const queryClient = useQueryClient();

  // 새로고침과 "지금 저장"을 한 버튼으로 합친다 — 사용자가 이 아이콘에 기대하는 건
  // "최신으로 맞춰줘"이고, 타임라인에서 그건 곧 미처리 이벤트 동기화다.
  const { mutate: refresh, isPending: isRefreshing } = useMutation({
    mutationFn: triggerManualSync,
    onSuccess: () => {
      queryClient.invalidateQueries();
      showToast('동기화를 요청했어요');
    },
    onError: () => {
      queryClient.invalidateQueries();
      showToast('동기화를 요청하지 못했어요. 화면만 새로고침했어요.');
    },
  });

  // Ask 답변 화면이 올라와 있는 동안에는 탭 대신 그 화면의 헤더 역할을 한다.
  if (askOpen) {
    return (
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-orbit-border bg-orbit-surface px-2 select-none">
        <button
          type="button"
          onClick={closeAsk}
          aria-label="답변 닫기"
          className="cursor-pointer rounded-md p-1.5 text-orbit-text transition hover:bg-orbit-bg"
        >
          <ChevronLeft size={18} />
        </button>
        <span className="text-sm font-bold text-orbit-text">Ask AI</span>
        {turns.length > 0 && (
          <button
            type="button"
            onClick={startNewConversation}
            className="ml-auto flex cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-[11px] text-orbit-muted transition hover:text-orbit-text"
          >
            <Trash2 size={11} /> 새 대화
          </button>
        )}
      </div>
    );
  }

  if (activeView === 'settings') {
    return (
      <div className="flex h-12 items-center justify-between border-b border-orbit-border bg-orbit-surface px-4 shrink-0">
        <span className="text-sm font-bold text-orbit-text">설정</span>
        <button
          type="button"
          onClick={() => setView('sessions')}
          className="p-1.5 rounded-md text-orbit-muted hover:bg-orbit-bg hover:text-orbit-text transition cursor-pointer"
        >
          <X size={16} />
        </button>
      </div>
    );
  }

  const tabs = [
    { view: 'timeline' as const, label: '타임라인' },
    { view: 'sessions' as const, label: '세션' },
    { view: 'tabs' as const, label: '열린 탭' },
  ];

  return (
    <div className="relative z-20 flex h-12 items-center justify-between border-b border-orbit-border bg-orbit-surface px-3 shrink-0 select-none">
      {/* Segmented Control Tabs */}
      <div className="flex rounded-full bg-orbit-bg p-0.5 border border-orbit-border/30">
        {tabs.map(({ view, label }) => {
          const active = activeView === view || (view === 'sessions' && activeView === 'detail');
          return (
            <button
              key={view}
              type="button"
              onClick={() => setView(view)}
              className={
                'rounded-full px-2.5 py-1 text-xs font-bold transition-all duration-200 cursor-pointer ' +
                (active
                  ? 'bg-orbit-surface text-orbit-primary shadow-orbit-raised'
                  : 'text-orbit-muted hover:text-orbit-text')
              }
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Quick Actions */}
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          title="새로고침 · 지금 저장"
          onClick={() => refresh()}
          disabled={isRefreshing}
          className="p-1.5 rounded-md text-orbit-muted hover:bg-orbit-bg hover:text-orbit-text transition cursor-pointer disabled:opacity-50"
        >
          {isRefreshing ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
        </button>
        <button
          type="button"
          title="설정"
          onClick={() => setView('settings')}
          className="p-1.5 rounded-md text-orbit-muted hover:bg-orbit-bg hover:text-orbit-text transition cursor-pointer"
        >
          <Settings size={14} />
        </button>
      </div>
    </div>
  );
}
