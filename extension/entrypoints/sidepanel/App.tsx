import { LoginGate } from './components/LoginGate';
import { TopNavBar } from './components/TopNavBar';
import { AskDock } from './components/AskDock';
import { Toast } from './components/Toast';
import { isAskDockView, useUIStore } from './store/ui';
import { TimelineView } from './views/TimelineView';
import { SessionListView } from './views/SessionListView';
import { OpenTabsView } from './views/OpenTabsView';
import { AskView } from './views/AskView';
import { SessionDetailView } from './views/SessionDetailView';
import { SettingsView } from './views/SettingsView';

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

export default function App() {
  const activeView = useUIStore((s) => s.activeView);
  const showAsk = isAskDockView(activeView);

  return (
    <LoginGate>
      <div className="flex h-full w-full flex-col overflow-hidden bg-orbit-bg text-orbit-text">
        <TopNavBar />
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <CurrentView />
          {showAsk && <AskView />}
        </main>
        {showAsk && <AskDock />}
        <Toast />
      </div>
    </LoginGate>
  );
}
