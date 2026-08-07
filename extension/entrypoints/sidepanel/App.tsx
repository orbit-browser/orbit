import { LoginGate } from './components/LoginGate';
import { TopNavBar } from './components/TopNavBar';
import { Toast } from './components/Toast';
import { useUIStore } from './store/ui';
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
