import { useEffect } from 'react';
import { LoginGate } from './components/LoginGate';
import { OnboardingPrototype } from './components/onboarding/OnboardingPrototype';
import { TopNavBar } from './components/TopNavBar';
import { AskDock } from './components/AskDock';
import { Toast } from './components/Toast';
import { isAskDockView, useUIStore } from './store/ui';
import { useSettingsStore } from './store/settings';
import { TimelineView } from './views/TimelineView';
import { SessionListView } from './views/SessionListView';
import { OpenTabsView } from './views/OpenTabsView';
import { AskView } from './views/AskView';
import { SessionDetailView } from './views/SessionDetailView';
import { SettingsView } from './views/SettingsView';
import { useOnboarding } from '../../lib/useOnboarding';

function CurrentView() {
  const view = useUIStore((s) => s.activeView);
  switch (view) {
    case 'timeline':
      return <TimelineView />;
    case 'sessions':
      return <SessionListView />;
    case 'tabs':
      return <OpenTabsView />;
    case 'detail':
      return <SessionDetailView />;
    case 'settings':
      return <SettingsView />;
  }
}

function SignedInPanel() {
  const activeView = useUIStore((s) => s.activeView);
  const showAsk = isAskDockView(activeView);
  const { state, loading } = useOnboarding();

  if (loading) return <div className="h-full w-full bg-orbit-bg" />;
  if (state.status !== 'complete') return <OnboardingPrototype initialStep={state.step} />;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-orbit-bg text-orbit-text">
      <TopNavBar />
      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <CurrentView />
        {showAsk && <AskView />}
      </main>
      {showAsk && <AskDock />}
      <Toast />
    </div>
  );
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
      <SignedInPanel />
    </LoginGate>
  );
}
