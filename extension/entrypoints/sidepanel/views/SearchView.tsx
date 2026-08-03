import { useState, useEffect } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { SessionCard } from '../components/SessionCard';
import { StatePlaceholder } from '../components/StatePlaceholder';
import { useSearch } from '../hooks/useSearch';
import { useSettingsStore } from '../store/settings';
import { useUIStore } from '../store/ui';

const PLACEHOLDERS = [
  'AI 에이전트 개발 공부하던 탭 복원해줘',
  '지난주에 찾아둔 제주도 맛집 목록 열어줘',
  '리액트 상태관리 라이브러리 공식문서들',
  '쇼핑 장바구니에 담아둔 상품 페이지',
  '독서 모임 준비용 서적 소개 탭들',
];

const TOP_N = 3;

export function SearchView() {
  const [inputValue, setInputValue] = useState('');
  
  // Zustand 스토어에서 검색어 유지
  const query = useUIStore((s) => s.searchQuery);
  const setSearchQuery = useUIStore((s) => s.setSearchQuery);
  
  const isActive = query.trim().length > 0;

  const rerankEnabled = useSettingsStore((s) => s.rerankEnabled);
  const { data: results, isFetching, isError } = useSearch(query);
  const topResults = results?.sessions.slice(0, TOP_N) ?? [];
  const degraded = results?.degraded ?? false;

  // Claude-style rolling placeholder text
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [fade, setFade] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setPlaceholderIdx((prev) => (prev + 1) % PLACEHOLDERS.length);
        setFade(true);
      }, 200); // fade out duration
    }, 3500);

    return () => clearInterval(timer);
  }, []);

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = inputValue.trim();
    if (q) {
      setSearchQuery(q);
      setInputValue(''); // 전송 후 입력창 비우기
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0 select-none">
      {/* Top Fixed Chat Input Area */}
      <form onSubmit={handleFormSubmit} className="p-4 pb-2 bg-orbit-bg border-b border-orbit-border/40 shrink-0">
        <div className="flex items-center gap-2 rounded-2xl border border-orbit-border bg-orbit-surface p-1.5 pl-3.5 transition-all duration-200 focus-within:border-orbit-primary/60 focus-within:ring-1 focus-within:ring-orbit-primary/20 shadow-xs relative">
          <div className="min-w-0 flex-1 relative py-1.5">
            {/* 가상 롤링 플레이스홀더 */}
            {!inputValue && (
              <span
                className={`absolute left-0 top-1/2 -translate-y-1/2 text-sm text-orbit-muted/60 pointer-events-none transition-opacity duration-200 select-none ${
                  fade ? 'opacity-100' : 'opacity-0'
                }`}
              >
                {PLACEHOLDERS[placeholderIdx]}
              </span>
            )}
            <input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="w-full bg-transparent text-sm outline-none text-orbit-text relative z-10"
            />
          </div>
          <button
            type="submit"
            disabled={!inputValue.trim()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orbit-primary text-white transition-all hover:scale-105 active:scale-95 disabled:bg-orbit-border disabled:text-orbit-muted/50 disabled:scale-100 cursor-pointer z-10"
          >
            <ArrowRight size={16} strokeWidth={2.5} />
          </button>
        </div>

        {/* 전송된 질문 텍스트 출력 (레이블과 따옴표 없이 깔끔하게) */}
        {query && (
          <div className="mt-2 pl-1 text-[11px] text-orbit-muted font-semibold truncate">
            {query}
          </div>
        )}
      </form>

      {/* Scrollable Results Area */}
      <div className="flex-1 overflow-y-auto min-h-0 p-4 pt-2">
        {isActive && (
          <section className="space-y-3">
            <div className="flex items-center gap-1.5 text-xs text-orbit-muted px-1">
              <Sparkles size={13} className="text-orbit-primary animate-pulse" />
              <span>
                {isFetching
                  ? rerankEnabled ? 'AI가 결과를 정렬 중…' : '유사한 세션 검색 중…'
                  : isError
                    ? '백엔드에 연결할 수 없어요. 서버 상태를 확인해 주세요.'
                  : degraded
                    ? topResults.length > 0
                      ? `간단 검색 결과 ${topResults.length}개 (백엔드 미연결)`
                      : '백엔드에 연결할 수 없어요 — 간단 검색으로도 찾지 못했어요'
                    : topResults.length > 0
                      ? `유사한 세션 ${topResults.length}개${rerankEnabled ? ' (AI 정렬 완료)' : ''}`
                      : '관련 세션을 찾지 못했어요'}
              </span>
            </div>
            <StatePlaceholder
              loading={isFetching}
              error={!isFetching && isError}
              empty={!isFetching && !isError && topResults.length === 0}
              emptyText="다른 키워드로 다시 검색해 보세요"
            >
              <div className="grid grid-cols-1 min-[500px]:grid-cols-2 min-[750px]:grid-cols-3 gap-3">
                {topResults.map((session) => (
                  <SessionCard key={session.id} session={session} showRestoreButton={true} />
                ))}
              </div>
            </StatePlaceholder>
          </section>
        )}
      </div>
    </div>
  );
}
