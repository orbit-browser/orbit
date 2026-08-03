import { RefreshCw, Settings, X } from 'lucide-react';
import { useUIStore } from '../store/ui';
import { useQueryClient } from '@tanstack/react-query';

export function TopNavBar() {
  const activeView = useUIStore((s) => s.activeView);
  const setView = useUIStore((s) => s.setView);
  const showToast = useUIStore((s) => s.showToast);
  const queryClient = useQueryClient();

  const isSettings = activeView === 'settings';

  if (isSettings) {
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
    { view: 'search' as const, label: 'Ask AI' },
  ];

  return (
    <div className="relative z-20 flex h-12 items-center justify-between border-b border-orbit-border bg-orbit-surface px-3 shrink-0 select-none">
      {/* Segmented Control Tabs */}
      <div className="flex rounded-lg bg-orbit-bg p-0.5 border border-orbit-border/30">
        {tabs.map(({ view, label }) => {
          const active = activeView === view || (view === 'sessions' && activeView === 'detail');
          return (
            <button
              key={view}
              type="button"
              onClick={() => setView(view)}
              className={
                'rounded-md px-2.5 py-1 text-xs font-bold transition-all duration-200 cursor-pointer ' +
                (active
                  ? 'bg-orbit-surface text-orbit-primary shadow-xs'
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
          title="새로고침"
          onClick={() => {
            queryClient.invalidateQueries();
            showToast('새로고침했어요');
          }}
          className="p-1.5 rounded-md text-orbit-muted hover:bg-orbit-bg hover:text-orbit-text transition cursor-pointer"
        >
          <RefreshCw size={14} />
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
