import { RefreshCw, Settings } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Logo } from './Logo';
import { useUIStore } from '../store/ui';

const iconBtn =
  'p-1.5 rounded-md text-orbit-muted hover:bg-orbit-bg hover:text-orbit-text transition';

export function Header() {
  const queryClient = useQueryClient();
  const setView = useUIStore((s) => s.setView);
  const showToast = useUIStore((s) => s.showToast);

  return (
    <header className="flex items-center gap-2 px-4 py-3 border-b border-orbit-border bg-orbit-surface">
      <Logo size={22} />
      <span className="text-base font-bold tracking-tight">Orbit</span>
      <div className="ml-auto flex items-center gap-0.5">
        <button
          type="button"
          className={iconBtn}
          title="새로고침"
          onClick={() => {
            queryClient.invalidateQueries();
            showToast('새로고침했어요');
          }}
        >
          <RefreshCw size={16} />
        </button>
        <button
          type="button"
          className={iconBtn}
          title="설정"
          onClick={() => setView('settings')}
        >
          <Settings size={16} />
        </button>
      </div>
    </header>
  );
}
