import { useUIStore } from './store/ui';
import { SessionDetailPanel } from './components/SessionDetailPanel';
import { HomeView } from './views/HomeView';
import { Toast } from './components/Toast';

export default function App() {
  const selectedSessionId = useUIStore((s) => s.selectedSessionId);

  return (
    <div className={selectedSessionId ? 'h-full' : 'min-h-full'}>
      {selectedSessionId ? (
        <SessionDetailPanel sessionId={selectedSessionId} />
      ) : (
        <HomeView />
      )}
      <Toast />
    </div>
  );
}
