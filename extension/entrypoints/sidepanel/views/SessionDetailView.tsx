import { useEffect, useState } from 'react';
import { AlignLeft, ArrowLeft, Pencil } from 'lucide-react';
import { useSession } from '../hooks/useSessions';
import { useUIStore } from '../store/ui';
import { TabListItem } from '../components/TabListItem';
import { StatePlaceholder } from '../components/StatePlaceholder';
import { openTabs } from '../../../lib/chrome-bridge';

export function SessionDetailView() {
  const selectedId = useUIStore((s) => s.selectedSessionId);
  const goBack = useUIStore((s) => s.goBackToSessions);
  const setView = useUIStore((s) => s.setView);
  const showToast = useUIStore((s) => s.showToast);
  const { data: session, isLoading, isError } = useSession(selectedId);

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');

  useEffect(() => {
    if (session) setTitle(session.title);
  }, [session]);

  function commitTitle() {
    setEditing(false);
    showToast('세션 이름을 변경했어요 (mock)');
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={goBack}
        className="flex items-center gap-1 text-xs text-orbit-muted hover:text-orbit-text"
      >
        <ArrowLeft size={14} />
        세션 목록
      </button>

      <StatePlaceholder
        loading={isLoading}
        error={isError}
        empty={!session}
        emptyText="세션을 찾을 수 없어요"
      >
        {session && (
          <>
            <div className="flex items-center gap-2">
              {editing ? (
                <input
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitTitle();
                  }}
                  className="min-w-0 flex-1 rounded-md border border-orbit-border px-2 py-1 text-base font-bold outline-none focus:border-orbit-primary"
                />
              ) : (
                <h2 className="min-w-0 flex-1 truncate text-base font-bold">{title}</h2>
              )}
              <button
                type="button"
                title="이름 편집"
                onClick={() => setEditing(true)}
                className="rounded-md p-1 text-orbit-muted hover:bg-orbit-bg"
              >
                <Pencil size={15} />
              </button>
            </div>

            <p className="text-xs text-orbit-muted">
              {session.tabs.length}개 탭 · {session.timeLabel} 저장
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setView('summary')}
                className="flex items-center gap-1.5 rounded-lg border border-orbit-border px-3 py-1.5 text-xs font-medium hover:bg-orbit-bg"
              >
                <AlignLeft size={14} />
                세션 요약
              </button>
              <button
                type="button"
                onClick={() => {
                  void openTabs(session.tabs.map((t) => t.url));
                  showToast('세션을 복원했어요 (mock)');
                }}
                className="flex items-center gap-1.5 rounded-lg bg-orbit-primary px-3 py-1.5 text-xs font-semibold text-white hover:brightness-95"
              >
                모든 탭 열기
              </button>
            </div>

            <div className="space-y-0.5 pt-1">
              {session.tabs.map((tab) => (
                <TabListItem key={tab.id} tab={tab} />
              ))}
            </div>
          </>
        )}
      </StatePlaceholder>
    </div>
  );
}
