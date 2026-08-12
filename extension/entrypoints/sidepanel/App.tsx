import { useEffect } from 'react';
import { LoginGate } from './components/LoginGate';
import { TopNavBar } from './components/TopNavBar';
import { Toast } from './components/Toast';
import { useUIStore } from './store/ui';
import { useSettingsStore } from './store/settings';
import { TimelineView } from './views/TimelineView';
import { SessionListView } from './views/SessionListView';
import { SearchView } from './views/SearchView';
import { SessionDetailView } from './views/SessionDetailView';
import { SettingsView } from './views/SettingsView';

function CurrentView() {
  const view = useUIStore((s) => s.activeView);
  switch (view) {
    case 'timeline':
      return <TimelineView />;
    case 'sessions':
      return <SessionListView />;
    case 'search':
      return <SearchView />;
    case 'detail':
      return <SessionDetailView />;
    case 'settings':
      return <SettingsView />;
  }
}

export default function App() {
  const theme = useSettingsStore((s) => s.theme);

  /*
   * 새 탭과 같은 방식으로 모양을 적용한다 — html[data-theme] 하나에 팔레트가 걸려 있다.
   * system 이면 OS 설정을 구독해 사이드패널을 다시 열지 않아도 따라간다.
   */
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    if (theme !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  return (
    <LoginGate>
      <div className="flex h-full w-full flex-col overflow-hidden bg-orbit-bg text-orbit-text">
        <TopNavBar />
        <main className="min-w-0 flex-1 flex flex-col min-h-0 overflow-hidden">
          <CurrentView />
        </main>
        <Toast />
      </div>
    </LoginGate>
  );
}
