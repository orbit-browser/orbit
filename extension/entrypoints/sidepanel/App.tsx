import { Header } from './components/Header';
import { NavRail } from './components/NavRail';
import { Toast } from './components/Toast';
import { useUIStore } from './store/ui';
import { SessionListView } from './views/SessionListView';
import { SearchView } from './views/SearchView';
import { SummaryView } from './views/SummaryView';
import { SessionDetailView } from './views/SessionDetailView';
import { SettingsView } from './views/SettingsView';

function CurrentView() {
  const view = useUIStore((s) => s.activeView);
  switch (view) {
    case 'sessions':
      return <SessionListView />;
    case 'search':
      return <SearchView />;
    case 'summary':
      return <SummaryView />;
    case 'detail':
      return <SessionDetailView />;
    case 'settings':
      return <SettingsView />;
  }
}

export default function App() {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-orbit-bg text-orbit-text">
      <Header />
      <div className="flex min-h-0 flex-1">
        <NavRail />
        <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4">
          <CurrentView />
        </main>
      </div>
      <Toast />
    </div>
  );
}
