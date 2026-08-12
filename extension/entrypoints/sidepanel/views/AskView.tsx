import { useEffect, useRef } from 'react';
import { RotateCcw, Sparkles } from 'lucide-react';
import { useAskConversation } from '../../shared/hooks/useAskConversation';
import { SessionCard } from '../components/SessionCard';
import { useSettingsStore } from '../store/settings';
import { useUIStore } from '../store/ui';

function tabLocation(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname === '/' ? '' : parsed.pathname}`;
  } catch {
    return url;
  }
}

/**
 * 현재 탭 위로 올라오는 Ask 답변 화면.
 *
 * 항상 마운트된 채 transform 으로만 오르내린다 — 언마운트하면 스크롤 위치가 매번 초기화된다.
 * 대화 자체는 useAskConversation 의 전역 store 에 있어 탭을 옮겨도 유지된다.
 */
export function AskView() {
  const askOpen = useUIStore((state) => state.askOpen);
  const rerankEnabled = useSettingsStore((state) => state.rerankEnabled);
  const { turns, ask, isStreaming, selectTabCandidate } = useAskConversation({
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
    <div
      aria-hidden={!askOpen}
      className={`absolute inset-0 z-20 flex flex-col bg-orbit-bg transition-transform duration-300 ease-out ${
        askOpen ? 'translate-y-0' : 'pointer-events-none translate-y-full'
      }`}
    >
      <div ref={conversationRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {turns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 pb-24 text-center text-xs text-orbit-muted">
            <Sparkles size={22} className="text-orbit-primary" />
            <p className="leading-relaxed">
              저장된 탐색 기록을 바탕으로 질문에 답하고 관련 세션을 함께 보여드려요.
            </p>
            <p className="text-orbit-muted/70">아래 입력창에 물어보세요.</p>
          </div>
        ) : (
          <>
            <p className="text-center text-[11px] text-orbit-muted/70">
              각 질문은 이전 답변을 참조하지 않아요
            </p>
            {turns.map((turn) => (
              <article key={turn.id} className="space-y-3">
                <div className="ml-auto w-fit max-w-[88%] rounded-2xl rounded-br-md bg-orbit-primary px-3.5 py-2.5 text-sm leading-relaxed text-white">
                  {turn.query}
                </div>

                <div className="rounded-2xl rounded-tl-md border border-orbit-border bg-orbit-surface p-3.5 shadow-orbit-card">
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
                          className="flex w-full cursor-pointer items-center gap-2 rounded-xl border border-orbit-border bg-orbit-bg px-3 py-2.5 text-left transition hover:border-orbit-primary/50 hover:bg-orbit-primary/5"
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
                    <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-orbit-bg px-3 py-2 text-xs text-orbit-danger">
                      <span>{turn.error}</span>
                      {turn.status !== 'streaming' && (
                        <button
                          type="button"
                          onClick={() => {
                            if (!isStreaming) void ask(turn.query);
                          }}
                          className="flex shrink-0 cursor-pointer items-center gap-1 font-semibold"
                        >
                          <RotateCcw size={11} /> 다시 시도
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {turn.sources.length > 0 && (
                  <div className="space-y-2">
                    <p className="px-1 text-xs font-semibold text-orbit-muted">관련 세션</p>
                    <div className="space-y-2">
                      {turn.sources.map((session, index) => (
                        <div key={session.id} className="relative">
                          <span className="absolute -left-1 -top-1 z-10 flex h-5 min-w-5 items-center justify-center rounded-full border border-orbit-border bg-orbit-bg px-1 text-[10px] font-bold text-orbit-primary shadow-2xs">
                            {index + 1}
                          </span>
                          <SessionCard session={session} showRestoreButton />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
