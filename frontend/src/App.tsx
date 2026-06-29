import { useUIStore } from './store/ui';
import { Sidebar } from './components/Sidebar';
import { SessionDetailPanel } from './components/SessionDetailPanel';
import { SessionListView } from './views/SessionListView';
import { SearchView } from './views/SearchView';
import { Toast } from './components/Toast';

const VIEW_TITLES: Record<string, string> = {
  sessions: '세션 목록',
  search: 'AI 검색',
};

function MainContent() {
  const activeView = useUIStore((s) => s.activeView);
  const selectedSessionId = useUIStore((s) => s.selectedSessionId);

  if (selectedSessionId) {
    return <SessionDetailPanel sessionId={selectedSessionId} />;
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <h1 className="mb-5 text-lg font-semibold">{VIEW_TITLES[activeView]}</h1>
      {activeView === 'sessions' && <SessionListView />}
      {activeView === 'search' && <SearchView />}
    </div>
  );
}

export default function App() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-orbit-bg">
        <MainContent />
      </main>
      <Toast />
    </div>
  );
}
