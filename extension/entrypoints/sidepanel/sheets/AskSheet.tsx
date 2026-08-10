import { useEffect, useRef } from 'react';
import { ChevronRight, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { useAskConversation } from '../../shared/hooks/useAskConversation';
import { Favicon } from '../components/Favicon';
import { ControlRow } from '../components/control/ControlRow';
import { Sheet } from '../components/control/Sheet';
import { useUIStore } from '../store/ui';
import { useSettingsStore } from '../store/settings';

function tabLocation(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname === '/' ? '' : parsed.pathname}`;
  } catch {
    return url;
  }
}

/**
 * Ask AI 시트 — 대화만 보여준다. 입력창은 시트 밖(하단 독)에 고정돼 있어
 * 시트를 닫아도 자리가 흔들리지 않는다.
 */
export function AskSheet() {
  const rerankEnabled = useSettingsStore((state) => state.rerankEnabled);
  const openSession = useUIStore((state) => state.openSession);
  const { turns, ask, startNewConversation, selectTabCandidate } = useAskConversation({
    rerank: rerankEnabled,
  });
  const conversationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const conversation = conversationRef.current;
      if (!conversation) return;
      conversation.scrollTo({
        top: conversation.scrollHeight,
        behavior: turns.at(-1)?.status === 'streaming' ? 'auto' : 'smooth',
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [turns]);

  return (
    <Sheet
      title="Ask AI"
      actions={
        turns.length > 0 ? (
          <button
            type="button"
            onClick={startNewConversation}
            title="새 대화 시작하기"
            aria-label="새 대화 시작하기"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-orbit-muted transition hover:bg-orbit-bg hover:text-orbit-text"
          >
            <Trash2 size={14} />
          </button>
        ) : undefined
      }
    >
      <div ref={conversationRef} className="h-full space-y-5 overflow-y-auto p-4">
        {turns.length === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center gap-2 px-5 text-center text-xs text-orbit-muted">
            <Sparkles size={20} className="text-orbit-primary" />
            <p>저장된 탐색 기록을 바탕으로 질문에 답하고 관련 세션을 함께 보여드려요.</p>
            <p className="text-[11px] text-orbit-muted/70">아래 입력창에 물어보세요.</p>
          </div>
        ) : (
          <>
            {turns.map((turn) => (
              <article key={turn.id} className="space-y-3">
                <div className="ml-auto w-fit max-w-[88%] rounded-2xl rounded-br-md bg-orbit-primary px-3.5 py-2.5 text-sm leading-relaxed text-white">
                  {turn.query}
                </div>

                <div className="rounded-2xl rounded-tl-md bg-orbit-tile p-3.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-orbit-muted">
                    <Sparkles size={12} className="text-orbit-primary" /> Orbit AI
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-orbit-text">
                    {turn.answer}
                    {turn.status === 'streaming' && (
                      <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-orbit-primary align-middle" />
                    )}
                  </p>

                  {turn.tabCandidates.length > 0 && (
                    <div className="mt-3 space-y-2" aria-label="이동할 탭 후보">
                      {turn.tabCandidates.map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => void selectTabCandidate(turn.id, tab.id)}
                          className="flex w-full cursor-pointer items-center gap-2 rounded-full bg-orbit-surface px-3 py-2.5 text-left shadow-2xs transition hover:bg-orbit-primary/5"
                        >
                          {tab.favIconUrl ? (
                            <img src={tab.favIconUrl} alt="" className="h-4 w-4 shrink-0 rounded-sm" />
                          ) : (
                            <span className="h-2 w-2 shrink-0 rounded-full bg-orbit-primary" />
                          )}
                          <span className="min-w-0 flex-1">
                            <strong className="block truncate text-xs text-orbit-text">
                              {tab.title}
                            </strong>
                            <small className="block truncate text-[10px] text-orbit-muted">
                              {tabLocation(tab.url)}
                            </small>
                          </span>
                          <span className="text-[10px] font-semibold text-orbit-primary">이동</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {turn.tabCandidateError && (
                    <p className="mt-2 text-xs text-orbit-danger" role="alert">
                      {turn.tabCandidateError}
                    </p>
                  )}

                  {turn.error && (
                    <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-orbit-surface px-3 py-2 text-xs text-orbit-danger">
                      <span>{turn.error}</span>
                      {turn.status !== 'streaming' && (
                        <button
                          type="button"
                          onClick={() => void ask(turn.query)}
                          className="flex shrink-0 cursor-pointer items-center gap-1 font-semibold"
                        >
                          <RotateCcw size={11} /> 다시 시도
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {turn.sources.length > 0 && (
                  <div className="space-y-0.5">
                    <p className="px-2 text-[11px] font-semibold text-orbit-muted">관련 세션</p>
                    {turn.sources.map((session) => (
                      <ControlRow
                        key={session.id}
                        icon={
                          session.tabs[0] ? (
                            <Favicon pageUrl={session.tabs[0].url} src={session.tabs[0].favIconUrl} size={18} />
                          ) : (
                            <span className="h-4 w-4 rounded-full bg-orbit-border" />
                          )
                        }
                        title={session.title}
                        active
                        onClick={() => openSession(session.id)}
                        trailing={
                          <>
                            <span className="text-[10px] tabular-nums text-orbit-muted">
                              {session.tabs.length}
                            </span>
                            <ChevronRight size={14} className="text-orbit-muted/60" aria-hidden />
                          </>
                        }
                      />
                    ))}
                  </div>
                )}
              </article>
            ))}
            <p className="px-1 text-center text-[11px] text-orbit-muted/70">
              각 질문은 이전 답변을 참조하지 않아요
            </p>
          </>
        )}
      </div>
    </Sheet>
  );
}
