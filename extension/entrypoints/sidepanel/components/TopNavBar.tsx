import { ChevronLeft, Settings, Trash2, X } from 'lucide-react';
import { useAskConversation } from '../../shared/hooks/useAskConversation';
import { useActiveWorkspace } from '../../../lib/useWorkspaces';
import { useUIStore } from '../store/ui';
import { WorkspaceSwitcher } from './team/WorkspaceSwitcher';

export function TopNavBar() {
  const activeView = useUIStore((s) => s.activeView);
  const askOpen = useUIStore((s) => s.askOpen);
  const closeAsk = useUIStore((s) => s.closeAsk);
  const setView = useUIStore((s) => s.setView);
  const { turns, startNewConversation } = useAskConversation();
  const { scopeId } = useActiveWorkspace();

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

  // 타임라인은 내 방문 기록 스트림이라 팀 화면에는 없다(팀 타임라인은 2단계).
  const tabs = [
    ...(scopeId ? [] : [{ view: 'timeline' as const, label: '타임라인' }]),
    { view: 'sessions' as const, label: scopeId ? '팀 세션' : '세션' },
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
      <div className="flex min-w-0 items-center gap-0.5">
        {/* 범위를 바꾸면 이전 범위의 답변이 섞이지 않게 대화를 비운다. */}
        <WorkspaceSwitcher onChange={startNewConversation} />
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
