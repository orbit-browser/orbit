import { Archive, Search } from 'lucide-react';
import type { View } from '../store/ui';
import { useUIStore } from '../store/ui';

const NAV_ITEMS: { view: View; label: string; icon: React.ReactNode }[] = [
  { view: 'sessions', label: '세션 목록', icon: <Archive size={18} /> },
  { view: 'search', label: 'AI 검색', icon: <Search size={18} /> },
];

export function Sidebar() {
  const activeView = useUIStore((s) => s.activeView);
  const setView = useUIStore((s) => s.setView);

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-orbit-border bg-orbit-surface px-3 py-5">
      <div className="mb-6 flex items-center gap-2 px-2">
        <span className="text-xl font-bold text-orbit-primary">Orbit</span>
        <span className="text-xs text-orbit-muted">대시보드</span>
      </div>

      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map(({ view, label, icon }) => (
          <button
            key={view}
            type="button"
            onClick={() => setView(view)}
            className={[
              'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition',
              activeView === view
                ? 'bg-orbit-primary-soft text-orbit-primary'
                : 'text-orbit-muted hover:bg-orbit-bg hover:text-orbit-text',
            ].join(' ')}
          >
            {icon}
            {label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
