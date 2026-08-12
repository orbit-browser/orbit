import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { useAskConversation } from '../../shared/hooks/useAskConversation';
import { useSettingsStore } from '../store/settings';
import { useUIStore } from '../store/ui';

const PLACEHOLDERS = [
  '지금 열린 GitHub 탭 찾아서 이동해줘',
  'AI 에이전트 개발 공부하던 내용 정리해줘',
  '지난주에 찾아둔 제주도 맛집은 어디였지?',
  '리액트 상태관리 라이브러리를 비교해줘',
  '최근 쇼핑한 상품 중 핵심 차이를 알려줘',
];

/**
 * 메인 탭 아래에 항상 붙어 있는 질문 입력창.
 *
 * 답변 화면(AskView)은 이 독 위로 올라오고 독 자체는 자리를 지킨다 —
 * 답변을 보는 중에도 다음 질문을 바로 이어서 던질 수 있어야 한다.
 */
export function AskDock() {
  const [value, setValue] = useState('');
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [fade, setFade] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const rerankEnabled = useSettingsStore((state) => state.rerankEnabled);
  const openAsk = useUIStore((state) => state.openAsk);
  const { ask, cancel, isStreaming } = useAskConversation({ rerank: rerankEnabled });

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

  function submit() {
    const query = value.trim();
    if (!query || isStreaming) return;
    setValue('');
    openAsk();
    void ask(query);
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="z-30 shrink-0 border-t border-orbit-border/60 bg-orbit-bg px-3 py-2.5"
    >
      <div className="flex items-center gap-2 rounded-full border border-orbit-border bg-orbit-surface py-1.5 pl-4 pr-1.5 transition focus-within:border-orbit-primary/70 focus-within:ring-1 focus-within:ring-orbit-primary/20">
        <div className="relative min-w-0 flex-1 py-0.5">
          {!value && (
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
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-label="탐색 기록에 질문하기"
            className="relative z-10 w-full bg-transparent text-sm text-orbit-text outline-none"
          />
        </div>

        {isStreaming ? (
          <button
            type="button"
            onClick={cancel}
            aria-label="답변 생성 중단"
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-orbit-text text-orbit-surface transition hover:opacity-85"
          >
            <Square size={11} fill="currentColor" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!value.trim()}
            aria-label="질문 보내기"
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-orbit-primary text-white transition-all hover:scale-105 active:scale-95 disabled:scale-100 disabled:bg-orbit-border disabled:text-orbit-muted/60"
          >
            <ArrowUp size={16} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </form>
  );
}
