import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Loader2, Plus, ExternalLink, RotateCw } from 'lucide-react';
import { useSession, useRenameSession, useRetrySummary } from '../hooks/useSessions';
import { useUIStore } from '../store/ui';
import { TabListItem } from '../components/TabListItem';
import { SummaryPanel } from '../components/SummaryPanel';
import { StatePlaceholder } from '../components/StatePlaceholder';
import { TimelineItem } from '../components/timeline/TimelineItem';
import { restoreInNewWindow, restoreInCurrentWindow } from '../../../lib/chrome-bridge';
import { fetchSessionEvents } from '../../../lib/api';

export function SessionDetailView() {
  const selectedId = useUIStore((s) => s.selectedSessionId);
  const goBack = useUIStore((s) => s.goBackToSessions);
  const showToast = useUIStore((s) => s.showToast);
  const pendingSessionIds = useUIStore((s) => s.pendingSessionIds);
  const { data: session, isLoading, isError } = useSession(selectedId);
  const { mutate: renameSession } = useRenameSession();
  const { mutate: retrySummary, isPending: isRetrying } = useRetrySummary();
  const { data: timelineEvents } = useQuery({
    queryKey: ['session-events', selectedId],
    queryFn: () => fetchSessionEvents(selectedId as string),
    enabled: !!selectedId,
  });

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [activeSubTab, setActiveSubTab] = useState<'tabs' | 'summary'>('tabs');

  // 복원 세부 옵션(새 창 / 이어서)을 토글하는 로컬 상태
  const [showOptions, setShowOptions] = useState(false);

  useEffect(() => {
    if (!showOptions) return;
    const timer = setTimeout(() => setShowOptions(false), 4000);
    return () => clearTimeout(timer);
  }, [showOptions]);

  const isPending =
    (!!selectedId && pendingSessionIds.includes(selectedId)) || session?.summaryStatus === 'pending';
  const isFailed = !isPending && session?.summaryStatus === 'failed';

  useEffect(() => {
    if (session) setTitle(session.title);
  }, [session]);

  function commitTitle() {
    setEditing(false);
    if (!selectedId || !title.trim() || title === session?.title) return;
    renameSession(
      { id: selectedId, title: title.trim() },
      { onSuccess: () => showToast('세션 이름을 변경했어요') },
    );
  }

  return (
    <div className="space-y-3 p-4 overflow-y-auto h-full">
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
              {session.tabs.length}개 탭 · {session.timeLabel} 활동
            </p>

            <div className="flex items-center justify-between gap-2">
              <div className="flex rounded-lg bg-orbit-bg p-0.5 border border-orbit-border/50">
                <button
                  type="button"
                  onClick={() => setActiveSubTab('tabs')}
                  className={
                    'rounded-md px-3 py-1.5 text-xs font-medium transition ' +
                    (activeSubTab === 'tabs'
                      ? 'bg-orbit-surface text-orbit-text shadow-xs'
                      : 'text-orbit-muted hover:text-orbit-text')
                  }
                >
                  탭 목록 ({session.tabs.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSubTab('summary')}
                  className={
                    'rounded-md px-3 py-1.5 text-xs font-medium transition ' +
                    (activeSubTab === 'summary'
                      ? 'bg-orbit-surface text-orbit-text shadow-xs'
                      : 'text-orbit-muted hover:text-orbit-text')
                  }
                >
                  AI 요약
                </button>
              </div>

              <div className="relative flex items-center justify-end shrink-0 select-none">
                <div
                  className={`relative flex h-[30px] items-center justify-end overflow-hidden rounded-xl transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
                    showOptions
                      ? 'w-[162px] border border-orbit-border/60 bg-orbit-bg p-0.5 shadow-2xs'
                      : 'w-[90px] border border-transparent bg-transparent p-0'
                  }`}
                >
                  {/* 복원 트리거 버튼 (평소 상태) */}
                  <button
                    type="button"
                    onClick={() => setShowOptions(true)}
                    className={`absolute inset-0 flex items-center justify-center rounded-lg bg-orbit-primary text-xs font-semibold text-white hover:brightness-95 transition-all duration-300 active:scale-95 cursor-pointer ${
                      showOptions ? 'opacity-0 pointer-events-none scale-90' : 'opacity-100 scale-100'
                    }`}
                  >
                    모든 탭 열기
                  </button>

                  {/* 세부 옵션들 (토글 후 팝업 상태) */}
                  <div
                    className={`flex h-full items-center gap-1 transition-all duration-300 ${
                      showOptions ? 'opacity-100 scale-100' : 'opacity-0 pointer-events-none scale-90'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        void restoreInNewWindow(session.tabs.map((t) => t.url));
                        showToast('새 창에 복원했어요');
                        setShowOptions(false);
                      }}
                      className="flex h-full items-center justify-center gap-1 rounded-lg bg-orbit-primary px-2 text-xs font-bold text-white transition hover:brightness-95 active:scale-95 cursor-pointer shrink-0"
                    >
                      <ExternalLink size={10} strokeWidth={2.5} />
                      새 창으로
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void restoreInCurrentWindow(session.tabs.map((t) => t.url));
                        showToast('현재 창에 복원했어요');
                        setShowOptions(false);
                      }}
                      className="flex h-full items-center justify-center gap-1 rounded-lg px-2 text-xs font-bold text-orbit-muted hover:text-orbit-text transition active:scale-95 cursor-pointer shrink-0"
                    >
                      <Plus size={10} strokeWidth={2.5} />
                      이어서
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-1">
              {activeSubTab === 'tabs' ? (
                <div className="space-y-0.5">
                  {session.tabs.map((tab) => (
                    <TabListItem key={tab.id} tab={tab} />
                  ))}
                </div>
              ) : isFailed ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 rounded-xl border border-orbit-border bg-orbit-surface text-orbit-muted select-none">
                  <p className="text-xs font-semibold text-red-500">AI 요약 생성 실패</p>
                  <p className="text-[10px] text-orbit-muted/80">
                    요약을 만드는 중 문제가 발생했어요. 다시 시도해 주세요.
                  </p>
                  <button
                    type="button"
                    onClick={() => selectedId && retrySummary(selectedId)}
                    disabled={isRetrying}
                    className="mt-1 flex items-center gap-1.5 rounded-lg bg-orbit-primary px-3 py-1.5 text-xs font-bold text-white transition hover:brightness-95 disabled:opacity-50 cursor-pointer"
                  >
                    <RotateCw size={12} className={isRetrying ? 'animate-spin' : ''} />
                    다시 시도
                  </button>
                </div>
              ) : isPending || !session.summary || !session.summary.overview ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 rounded-xl border border-orbit-border bg-orbit-surface text-orbit-muted select-none">
                  <Loader2 size={20} className="animate-spin text-orbit-primary" />
                  <p className="text-xs font-semibold text-orbit-primary">AI 요약 중…</p>
                  <p className="text-[10px] text-orbit-muted/80">
                    AI가 이 세션의 탭 내용을 분석하고 요약 중이에요.
                  </p>
                </div>
              ) : (
                <SummaryPanel summary={session.summary} />
              )}
            </div>

            {!!timelineEvents?.length && (
              <div className="pt-1">
                <p className="mb-1 px-1 text-xs font-semibold text-orbit-muted">탐색 타임라인</p>
                <div className="space-y-0.5 rounded-xl border border-orbit-border bg-orbit-surface p-1">
                  {timelineEvents.map((ev) => (
                    <TimelineItem
                      key={ev.eventId}
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
              </div>
            )}
          </>
        )}
      </StatePlaceholder>
    </div>
  );
}
