import { useState, useEffect } from 'react';
import { Loader2, Calendar, Plus, ExternalLink, RotateCw } from 'lucide-react';
import type { Session } from '../../../lib/types';
import { useUIStore } from '../store/ui';
import { useDeleteSession, useRetrySummary } from '../hooks/useSessions';
import { restoreInNewWindow, restoreInCurrentWindow } from '../../../lib/chrome-bridge';
import { OverflowMenu } from './OverflowMenu';
import { Favicon } from './Favicon';

export function SessionCard({
  session,
  showRestoreButton = false,
}: {
  session: Session;
  showRestoreButton?: boolean;
}) {
  const openSession = useUIStore((s) => s.openSession);
  const showToast = useUIStore((s) => s.showToast);
  const { mutate: deleteSession } = useDeleteSession();
  const { mutate: retrySummary, isPending: isRetrying } = useRetrySummary();
  const isPending = useUIStore((s) => s.pendingSessionIds.includes(session.id));

  // 복원 세부 옵션(새 창 / 이어서)을 토글하는 로컬 상태
  const [showOptions, setShowOptions] = useState(false);

  useEffect(() => {
    if (!showOptions) return;
    const timer = setTimeout(() => setShowOptions(false), 4000);
    return () => clearTimeout(timer);
  }, [showOptions]);

  const isSummarizing = isPending || session.summaryStatus === 'pending';
  const isFailed = !isSummarizing && session.summaryStatus === 'failed';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openSession(session.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') openSession(session.id);
      }}
      className="group flex flex-col gap-3 rounded-orbit-card border border-orbit-border bg-orbit-surface p-4 transition-all duration-200 hover:border-orbit-primary/30 hover:shadow-orbit-card cursor-pointer select-none"
    >
      {/* Top Row: Title and Menu */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isSummarizing && (
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-orbit-bg">
              <Loader2 size={14} className="animate-spin text-orbit-primary" />
            </div>
          )}
          <h3 className="truncate text-sm font-semibold text-orbit-text">
            {isSummarizing ? 'AI가 주제 분류 및 요약 중…' : session.title}
          </h3>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isFailed && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                retrySummary(session.id);
              }}
              disabled={isRetrying}
              className="flex items-center gap-1 rounded-full bg-orbit-bg px-2.5 py-1 text-[11px] font-bold text-orbit-danger transition hover:bg-orbit-danger-soft disabled:opacity-50 cursor-pointer shrink-0 mr-1"
            >
              <RotateCw size={10} className={isRetrying ? 'animate-spin' : ''} />
              다시 시도
            </button>
          )}
          {!isSummarizing && showRestoreButton && (
            <div
              className={`relative flex h-[26px] items-center justify-end overflow-hidden rounded-lg transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
                showOptions
                  ? 'w-[118px] border border-orbit-border/60 bg-orbit-bg p-0.5 mr-1 shadow-2xs'
                  : 'w-[48px] border border-transparent bg-transparent p-0 mr-1'
              }`}
            >
              {/* 복원 트리거 버튼 (평소 상태) */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowOptions(true);
                }}
                className={`absolute inset-0 flex items-center justify-center rounded-md bg-orbit-primary text-[11px] font-bold text-white transition-all duration-300 hover:brightness-95 active:scale-95 cursor-pointer ${
                  showOptions ? 'opacity-0 pointer-events-none scale-90' : 'opacity-100 scale-100'
                }`}
              >
                복원
              </button>

              {/* 세부 옵션들 (토글 후 팝업 상태) */}
              <div
                className={`flex h-full items-center gap-1 transition-all duration-300 ${
                  showOptions ? 'opacity-100 scale-100' : 'opacity-0 pointer-events-none scale-90'
                }`}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void restoreInNewWindow(session.tabs.map((t) => t.url));
                    showToast('새 창에 복원했어요');
                    setShowOptions(false);
                  }}
                  className="flex h-full items-center justify-center gap-1 rounded-md bg-orbit-primary px-2 text-[11px] font-bold text-white transition hover:brightness-95 active:scale-95 cursor-pointer shrink-0"
                >
                  <ExternalLink size={9} strokeWidth={2.5} />
                  새 창
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void restoreInCurrentWindow(session.tabs.map((t) => t.url));
                    showToast('현재 창에 복원했어요');
                    setShowOptions(false);
                  }}
                  className="flex h-full items-center justify-center gap-1 rounded-md px-2 text-[11px] font-bold text-orbit-muted hover:text-orbit-text transition active:scale-95 cursor-pointer shrink-0"
                >
                  <Plus size={9} strokeWidth={2.5} />
                  이어서
                </button>
              </div>
            </div>
          )}
          <OverflowMenu
            actions={[
              {
                label: '새 창으로 복원',
                onClick: () => {
                  void restoreInNewWindow(session.tabs.map((t) => t.url));
                  showToast('새 창에 복원했어요');
                },
              },
              {
                label: '현재 창에 복원',
                onClick: () => {
                  void restoreInCurrentWindow(session.tabs.map((t) => t.url));
                  showToast('현재 창에 복원했어요');
                },
              },
              { label: '상세 보기', onClick: () => openSession(session.id) },
              {
                label: '삭제',
                danger: true,
                onClick: () =>
                  deleteSession(session.id, {
                    onSuccess: () => showToast('세션을 삭제했어요'),
                  }),
              },
            ]}
          />
        </div>
      </div>

      {/* Middle Row: Overview Summary */}
      {isFailed ? (
        <p className="line-clamp-2 text-xs text-orbit-danger leading-relaxed">
          AI 요약 생성에 실패했어요. 다시 시도해 주세요.
        </p>
      ) : (
        !isSummarizing &&
        session.summary?.overview && (
          <p className="line-clamp-2 text-xs text-orbit-muted leading-relaxed">
            {session.summary.overview}
          </p>
        )
      )}

      {/* Bottom Row: Tab Icons & Metadata */}
      <div className="flex items-center justify-between border-t border-orbit-border/40 pt-2.5 mt-0.5">
        {/* Tab Favicons */}
        <div className="flex -space-x-1.5 overflow-hidden">
          {session.tabs.slice(0, 5).map((t) => (
            <div
              key={t.id}
              className="inline-block h-5 w-5 rounded-full ring-2 ring-orbit-surface bg-white overflow-hidden shrink-0"
              title={t.title}
            >
              <Favicon src={t.favIconUrl} />
            </div>
          ))}
          {session.tabs.length > 5 && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-orbit-bg text-[9px] font-bold text-orbit-muted ring-2 ring-orbit-surface shrink-0">
              +{session.tabs.length - 5}
            </span>
          )}
        </div>

        {/* Time label */}
        <div className="flex items-center gap-1 text-[10px] text-orbit-muted font-medium">
          <Calendar size={11} className="text-orbit-muted/70" />
          <span>{session.timeLabel}</span>
        </div>
      </div>
    </div>
  );
}
