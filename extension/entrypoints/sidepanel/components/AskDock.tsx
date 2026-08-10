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
 * 하단에 상시 고정되는 Ask AI 입력창.
 *
 * 시트 밖(셸 바닥)에 있어 어떤 시트를 보고 있든 자리가 같다.
 * 질문을 보내면 Ask 시트가 올라오고 답변이 그 위로 쌓인다 —
 * macOS 에서 Wi-Fi 타일의 `›` 를 눌러 팝오버가 올라오는 것과 같은 동작이다.
 */
export function AskDock() {
  const [inputValue, setInputValue] = useState('');
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [fade, setFade] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const rerankEnabled = useSettingsStore((state) => state.rerankEnabled);
  const openSheet = useUIStore((state) => state.openSheet);
  const setSearchQuery = useUIStore((state) => state.setSearchQuery);
  const { ask, cancel, isStreaming } = useAskConversation({ rerank: rerankEnabled });

  useEffect(() => {
    // 입력 중에는 자리 표시자가 바뀌어도 보이지 않으므로 굳이 멈추지 않는다.
    const timer = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setPlaceholderIdx((previous) => (previous + 1) % PLACEHOLDERS.length);
        setFade(true);
      }, 200);
    }, 3500);
    return () => clearInterval(timer);
  }, []);

  function submit(query: string) {
    const trimmed = query.trim();
    if (!trimmed || isStreaming) return;
    setSearchQuery(trimmed);
    setInputValue('');
    openSheet({ kind: 'ask' });
    void ask(trimmed);
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit(inputValue);
      }}
      className="shrink-0 border-t border-orbit-border/60 bg-orbit-surface p-2.5"
    >
      <div className="flex items-center gap-1.5 rounded-full border border-orbit-border bg-orbit-bg p-1 pl-4 shadow-orbit-raised transition-all duration-200 focus-within:border-orbit-primary/60 focus-within:ring-1 focus-within:ring-orbit-primary/20">
        <div className="relative min-w-0 flex-1 py-1">
          {!inputValue && (
            <span
              className={`pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 select-none truncate text-xs text-orbit-muted/60 transition-opacity duration-200 ${
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
            onFocus={() => openSheet({ kind: 'ask' })}
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
            <Square size={11} fill="currentColor" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!inputValue.trim()}
            aria-label="질문 보내기"
            className="z-10 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-orbit-primary text-white transition-all hover:scale-105 active:scale-95 disabled:scale-100 disabled:bg-orbit-border disabled:text-orbit-muted/50"
          >
            <ArrowUp size={16} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </form>
  );
}
