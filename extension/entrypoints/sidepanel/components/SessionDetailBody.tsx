import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ExternalLink, Loader2, Pencil, Plus, RotateCw, Trash2 } from 'lucide-react';
import { fetchSessionEvents } from '../../../lib/api';
import { restoreInCurrentWindow, restoreInNewWindow } from '../../../lib/chrome-bridge';
import { useDeleteSession, useRenameSession, useRetrySummary, useSession } from '../hooks/useSessions';
import { useUIStore } from '../store/ui';
import { ControlSection } from './control/ControlRow';
import { StatePlaceholder } from './StatePlaceholder';
import { SummaryPanel } from './SummaryPanel';
import { TabListItem } from './TabListItem';
import { TimelineItem } from './timeline/TimelineItem';

/**
 * 세션 상세 — 목록의 해당 행 **아래에** 펼쳐진다.
 *
 * 제목은 위의 행이 이미 보여주므로 여기서 반복하지 않는다.
 */
export function SessionDetailBody({ sessionId }: { sessionId: string }) {
  const showToast = useUIStore((s) => s.showToast);
  const collapseSession = useUIStore((s) => s.collapseSession);
  const pendingSessionIds = useUIStore((s) => s.pendingSessionIds);
  const { data: session, isLoading, isError } = useSession(sessionId);
  const { mutate: renameSession } = useRenameSession();
  const { mutate: deleteSession } = useDeleteSession();
  const { mutate: retrySummary, isPending: isRetrying } = useRetrySummary();
  const { data: timelineEvents } = useQuery({
    queryKey: ['session-events', sessionId],
    queryFn: () => fetchSessionEvents(sessionId),
    enabled: !!sessionId,
  });

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [activeSubTab, setActiveSubTab] = useState<'tabs' | 'summary'>('tabs');
  const [showOptions, setShowOptions] = useState(false);

  useEffect(() => {
    if (!showOptions) return;
    const timer = setTimeout(() => setShowOptions(false), 4000);
    return () => clearTimeout(timer);
  }, [showOptions]);

  useEffect(() => {
    if (session) setTitle(session.title);
  }, [session]);

  const isPending = pendingSessionIds.includes(sessionId) || session?.summaryStatus === 'pending';
  const isFailed = !isPending && session?.summaryStatus === 'failed';

  function commitTitle() {
    setEditing(false);
    if (!title.trim() || title === session?.title) return;
    renameSession(
      { id: sessionId, title: title.trim() },
      { onSuccess: () => showToast('세션 이름을 변경했어요') },
    );
  }

  return (
    <div className="space-y-2.5 px-1 pb-3 pt-1">
      <StatePlaceholder
        loading={isLoading}
        error={isError}
        empty={!session}
        emptyText="세션을 찾을 수 없어요"
      >
        {session && (
          <>
            {editing && (
              <div className="flex items-center gap-1.5 px-1">
                <input
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitTitle();
                    if (e.key === 'Escape') {
                      setTitle(session.title);
                      setEditing(false);
                    }
                  }}
                  aria-label="세션 이름"
                  className="min-w-0 flex-1 rounded-full border border-orbit-border px-3 py-1 text-sm font-bold outline-none focus:border-orbit-primary"
                />
                <button
                  type="button"
                  title="이름 저장"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={commitTitle}
                  className="cursor-pointer rounded-full p-1 text-orbit-primary transition hover:bg-orbit-primary-soft"
                >
                  <Check size={15} />
                </button>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 px-1">
              <div className="flex rounded-full bg-orbit-tile p-0.5">
                <button
                  type="button"
                  onClick={() => setActiveSubTab('tabs')}
                  className={
                    'cursor-pointer rounded-full px-2.5 py-1 text-[11px] font-bold transition ' +
                    (activeSubTab === 'tabs'
                      ? 'bg-orbit-surface text-orbit-text shadow-2xs'
                      : 'text-orbit-muted hover:text-orbit-text')
                  }
                >
                  탭 {session.tabs.length}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSubTab('summary')}
                  className={
                    'cursor-pointer rounded-full px-2.5 py-1 text-[11px] font-bold transition ' +
                    (activeSubTab === 'summary'
                      ? 'bg-orbit-surface text-orbit-text shadow-2xs'
                      : 'text-orbit-muted hover:text-orbit-text')
                  }
                >
                  AI 요약
                </button>
              </div>

              <div
                className={`relative flex h-[26px] select-none items-center justify-end overflow-hidden rounded-full transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
                  showOptions ? 'w-[150px] bg-orbit-tile p-0.5' : 'w-[78px] bg-transparent p-0'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setShowOptions(true)}
                  className={`absolute inset-0 flex cursor-pointer items-center justify-center rounded-full bg-orbit-primary text-[11px] font-bold text-white transition-all duration-300 hover:brightness-95 active:scale-95 ${
                    showOptions ? 'pointer-events-none scale-90 opacity-0' : 'scale-100 opacity-100'
                  }`}
                >
                  모두 열기
                </button>

                <div
                  className={`flex h-full items-center gap-1 transition-all duration-300 ${
                    showOptions ? 'scale-100 opacity-100' : 'pointer-events-none scale-90 opacity-0'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      void restoreInNewWindow(session.tabs.map((t) => t.url));
                      showToast('새 창에 복원했어요');
                      setShowOptions(false);
                    }}
                    className="flex h-full shrink-0 cursor-pointer items-center gap-1 rounded-full bg-orbit-primary px-2 text-[11px] font-bold text-white transition hover:brightness-95 active:scale-95"
                  >
                    <ExternalLink size={9} strokeWidth={2.5} />새 창
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void restoreInCurrentWindow(session.tabs.map((t) => t.url));
                      showToast('현재 창에 복원했어요');
                      setShowOptions(false);
                    }}
                    className="flex h-full shrink-0 cursor-pointer items-center gap-1 rounded-full px-2 text-[11px] font-bold text-orbit-muted transition hover:text-orbit-text active:scale-95"
                  >
                    <Plus size={9} strokeWidth={2.5} />
                    이어서
                  </button>
                </div>
              </div>
            </div>

            {activeSubTab === 'tabs' ? (
              <div className="space-y-0.5">
                {session.tabs.map((tab) => (
                  <TabListItem key={tab.id} tab={tab} />
                ))}
              </div>
            ) : isFailed ? (
              <div className="flex select-none flex-col items-center justify-center gap-2 rounded-[18px] bg-orbit-tile py-8 text-orbit-muted">
                <p className="text-xs font-semibold text-orbit-danger">AI 요약 생성 실패</p>
                <button
                  type="button"
                  onClick={() => retrySummary(sessionId)}
                  disabled={isRetrying}
                  className="flex cursor-pointer items-center gap-1.5 rounded-full bg-orbit-primary px-3 py-1.5 text-[11px] font-bold text-white transition hover:brightness-95 disabled:opacity-50"
                >
                  <RotateCw size={11} className={isRetrying ? 'animate-spin' : ''} />
                  다시 시도
                </button>
              </div>
            ) : isPending || !session.summary?.overview ? (
              <div className="flex select-none flex-col items-center justify-center gap-2 rounded-[18px] bg-orbit-tile py-8 text-orbit-muted">
                <Loader2 size={18} className="animate-spin text-orbit-primary" />
                <p className="text-xs font-semibold text-orbit-primary">AI 요약 중…</p>
              </div>
            ) : (
              <SummaryPanel summary={session.summary} />
            )}

            {!!timelineEvents?.length && (
              <ControlSection label="탐색 타임라인">
                <div className="space-y-0.5 rounded-[18px] bg-orbit-tile p-1">
                  {timelineEvents.map((ev) => (
                    <TimelineItem
                      key={ev.eventId}
                      compact
                      event={{
                        id: ev.eventId,
                        url: ev.url,
                        title: ev.title,
                        domain: ev.domain,
                        visitedAt: ev.visitedAt,
                        durationMs: ev.durationMs,
                      }}
                    />
                  ))}
                </div>
              </ControlSection>
            )}

            <div className="flex items-center justify-end gap-1 px-1 pt-0.5">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="flex cursor-pointer items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold text-orbit-muted transition hover:bg-orbit-tile hover:text-orbit-text"
              >
                <Pencil size={11} /> 이름 편집
              </button>
              <button
                type="button"
                onClick={() =>
                  deleteSession(sessionId, {
                    onSuccess: () => {
                      showToast('세션을 삭제했어요');
                      collapseSession();
                    },
                  })
                }
                className="flex cursor-pointer items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold text-orbit-danger transition hover:bg-orbit-danger-soft"
              >
                <Trash2 size={11} /> 삭제
              </button>
            </div>
          </>
        )}
      </StatePlaceholder>
    </div>
  );
}
