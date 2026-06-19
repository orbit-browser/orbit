import { AlignLeft, Layers, Search, Settings, type LucideIcon } from 'lucide-react';
import { useUIStore, type View } from '../store/ui';

const items: { view: View; icon: LucideIcon; label: string }[] = [
  { view: 'sessions', icon: Layers, label: '세션' },
  { view: 'search', icon: Search, label: '검색' },
  { view: 'summary', icon: AlignLeft, label: '요약' },
  { view: 'settings', icon: Settings, label: '설정' },
];

export function NavRail() {
  const activeView = useUIStore((s) => s.activeView);
  const setView = useUIStore((s) => s.setView);

  return (
    <nav className="flex flex-col items-center gap-1 py-3 px-1.5 border-r border-orbit-border bg-orbit-surface">
      {items.map(({ view, icon: Icon, label }) => {
        // 상세 화면(detail)은 '세션' 탭의 하위 화면이므로 세션을 활성으로 표시
        const active = activeView === view || (view === 'sessions' && activeView === 'detail');
        return (
          <button
            key={view}
            type="button"
            title={label}
            onClick={() => setView(view)}
            className={
              'flex flex-col items-center gap-0.5 w-14 py-2 rounded-lg transition ' +
              (active
                ? 'bg-orbit-primary-soft text-orbit-primary'
                : 'text-orbit-muted hover:bg-orbit-bg hover:text-orbit-text')
            }
          >
            <Icon size={18} />
            <span className="text-[10px] font-medium">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
