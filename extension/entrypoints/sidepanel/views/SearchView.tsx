import { useEffect, useRef, useState } from 'react';
import { ArrowRight, RotateCcw, Sparkles, Square, Trash2 } from 'lucide-react';
import { useAskConversation } from '../../shared/hooks/useAskConversation';
import { SessionCard } from '../components/SessionCard';
import { useSettingsStore } from '../store/settings';
import { useUIStore } from '../store/ui';

const PLACEHOLDERS = [
  '지금 열린 GitHub 탭 찾아서 이동해줘',
  'AI 에이전트 개발 공부하던 내용 정리해줘',
  '지난주에 찾아둔 제주도 맛집은 어디였지?',
  '리액트 상태관리 라이브러리를 비교해줘',
  '최근 쇼핑한 상품 중 핵심 차이를 알려줘',
];

function tabLocation(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname === '/' ? '' : parsed.pathname}`;
  } catch {
    return url;
  }
}

export function SearchView() {
  const [inputValue, setInputValue] = useState('');
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [fade, setFade] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const rerankEnabled = useSettingsStore((state) => state.rerankEnabled);
  const setSearchQuery = useUIStore((state) => state.setSearchQuery);
  const {
    turns,
    ask,
    cancel,
    startNewConversation,
    isStreaming,
    selectTabCandidate,
  } = useAskConversation({ rerank: rerankEnabled });

  useEffect(() => {
    const timer = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setPlaceholderIdx((previous) => (previous + 1) % PLACEHOLDERS.length);
        setFade(true);
      }, 200);
    }, 3500);
    return () => clearInterval(timer);
  }, []);

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

  function submit(query: string) {
    const trimmed = query.trim();
    if (!trimmed || isStreaming) return;
    setSearchQuery(trimmed);
    setInputValue('');
    void ask(trimmed);
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }

  return (
    <div className="flex h-full min-h-0 flex-col select-none">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(inputValue);
        }}
        className="shrink-0 border-b border-orbit-border/40 bg-orbit-bg p-4 pb-2"
      >
        <div className="relative flex items-center gap-2 rounded-2xl border border-orbit-border bg-orbit-surface p-1.5 pl-3.5 shadow-orbit-raised transition-all duration-200 focus-within:border-orbit-primary/60 focus-within:ring-1 focus-within:ring-orbit-primary/20">
          <div className="relative min-w-0 flex-1 py-1.5">
            {!inputValue && (
              <span
                className={`pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 select-none truncate text-sm text-orbit-muted/60 transition-opacity duration-200 ${
                  fade ? 'opacity-100' : 'opacity-0'
                }`}
              >
                {PLACEHOLDERS[placeholderIdx]}
              </span>
            )}
            <input
              ref={inputRef}
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              aria-label="탐색 기록에 질문하기"
              className="relative z-10 w-full bg-transparent text-sm text-orbit-text outline-none"
            />
          </div>
          {isStreaming ? (
            <button
              type="button"
              onClick={cancel}
              aria-label="답변 생성 중단"
              className="z-10 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-orbit-text text-orbit-surface transition hover:opacity-85"
            >
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!inputValue.trim()}
              aria-label="질문 보내기"
              className="z-10 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-orbit-primary text-white transition-all hover:scale-105 active:scale-95 disabled:scale-100 disabled:bg-orbit-border disabled:text-orbit-muted/50"
            >
              <ArrowRight size={16} strokeWidth={2.5} />
            </button>
          )}
        </div>
        {turns.length > 0 && (
          <div className="mt-2 flex items-center justify-between px-1">
            <span className="text-[11px] font-semibold text-orbit-muted">각 질문은 이전 답변을 참조하지 않아요</span>
            <button
              type="button"
              onClick={startNewConversation}
              className="flex cursor-pointer items-center gap-1 text-[11px] text-orbit-muted transition hover:text-orbit-text"
            >
              <Trash2 size={11} /> 새 대화 시작하기
            </button>
          </div>
        )}
      </form>

      <div ref={conversationRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 pt-3">
        {turns.length === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center gap-2 px-5 text-center text-xs text-orbit-muted">
            <Sparkles size={20} className="text-orbit-primary" />
            <p>저장된 탐색 기록을 바탕으로 질문에 답하고 관련 세션을 함께 보여드려요.</p>
          </div>
        ) : (
          turns.map((turn) => (
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
                          <strong className="block truncate text-xs text-orbit-text">{tab.title}</strong>
                          <small className="block truncate text-[10px] text-orbit-muted">{tabLocation(tab.url)}</small>
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
                        onClick={() => submit(turn.query)}
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
          ))
        )}
      </div>
    </div>
  );
}
