import { useSessions } from '../hooks/useSessions';
import { SessionCard } from '../components/SessionCard';

export function SessionListView() {
  const { data: sessions, isLoading, isError } = useSessions();

  if (isLoading) {
    return <p className="text-sm text-orbit-muted">불러오는 중…</p>;
  }

  if (isError) {
    return (
      <p className="text-sm text-red-500">
        백엔드에 연결할 수 없어요. 서버가 실행 중인지 확인해 주세요.
      </p>
    );
  }

  if (!sessions?.length) {
    return (
      <p className="text-sm text-orbit-muted">
        저장된 세션이 없어요. Chrome 익스텐션으로 탭을 저장해보세요.
      </p>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {sessions.map((session) => (
        <SessionCard key={session.id} session={session} />
      ))}
    </div>
  );
}
