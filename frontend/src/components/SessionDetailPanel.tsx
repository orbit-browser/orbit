import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useSession } from '../hooks/useSessions';
import { useUIStore } from '../store/ui';

export function SessionDetailPanel({ sessionId }: { sessionId: string }) {
  const { data: session, isLoading } = useSession(sessionId);
  const closeSession = useUIStore((s) => s.closeSession);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-orbit-muted text-sm">
        불러오는 중…
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center text-orbit-muted text-sm">
        세션을 찾을 수 없어요
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-orbit-border bg-orbit-surface px-6 py-4">
        <button
          type="button"
          onClick={closeSession}
          className="rounded-lg p-1.5 text-orbit-muted transition hover:bg-orbit-bg"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{session.title}</h2>
          <p className="text-xs text-orbit-muted">
            {session.tabs.length}개 탭 · {session.timeLabel}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
        <section>
          <p className="text-xs font-semibold text-orbit-muted mb-2">개요</p>
          <p className="text-sm leading-relaxed">{session.summary.overview}</p>
          {session.summary.purpose && (
            <p className="mt-1 text-sm text-orbit-muted">{session.summary.purpose}</p>
          )}
        </section>

        {session.summary.highlights.length > 0 && (
          <section>
            <p className="text-xs font-semibold text-orbit-muted mb-2">핵심 정보</p>
            <ul className="space-y-1">
              {session.summary.highlights.map((h, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-orbit-primary" />
                  {h}
                </li>
              ))}
            </ul>
          </section>
        )}

        {session.summary.todos && session.summary.todos.length > 0 && (
          <section>
            <p className="text-xs font-semibold text-orbit-muted mb-2">할 일</p>
            <ul className="space-y-1">
              {session.summary.todos.map((t, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5">☐</span>
                  {t}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <p className="text-xs font-semibold text-orbit-muted mb-2">탭 목록</p>
          <div className="space-y-2">
            {session.tabs.map((tab) => (
              <a
                key={tab.id}
                href={tab.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 rounded-lg border border-orbit-border bg-orbit-bg p-3 text-sm transition hover:border-orbit-primary/40"
              >
                {tab.favIconUrl && (
                  <img
                    src={tab.favIconUrl}
                    alt=""
                    className="h-4 w-4 shrink-0 rounded-sm"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                )}
                <span className="min-w-0 flex-1 truncate text-orbit-text">{tab.title}</span>
                <ExternalLink size={13} className="shrink-0 text-orbit-muted" />
              </a>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
