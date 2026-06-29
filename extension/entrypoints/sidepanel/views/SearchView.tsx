import { useState } from 'react';
import { Send, Sparkles } from 'lucide-react';
import { SuggestedSessionItem } from '../components/SuggestedSessionItem';
import { StatePlaceholder } from '../components/StatePlaceholder';
import { useSearch } from '../hooks/useSearch';
import { useSettingsStore } from '../store/settings';

const EXAMPLES = [
  '저번에 리액트 튜토리얼 봤던 거',
  'AI 논문 읽던 탭들',
  '쇼핑하다 닫은 창',
];

const TOP_N = 3;

export function SearchView() {
  const [inputValue, setInputValue] = useState('');
  const [query, setQuery] = useState('');
  const isActive = query.trim().length > 0;

  const rerankEnabled = useSettingsStore((s) => s.rerankEnabled);
  const { data: results, isFetching } = useSearch(query);
  const topResults = results?.slice(0, TOP_N) ?? [];

  function submit(value = inputValue) {
    const q = value.trim();
    if (q) {
      setInputValue(q);
      setQuery(q);
    }
  }

  return (
    <div className="space-y-4">
      {/* 검색창 */}
      <div>
        <p className="mb-1.5 text-xs font-semibold text-orbit-muted">세션 복원</p>
        <div className="flex items-center gap-2 rounded-xl border border-orbit-border bg-orbit-surface px-3 py-2 transition focus-within:border-orbit-primary/50">
          <input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="예: 저번에 AI 에이전트 자료 봤던 거"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-orbit-muted"
          />
          <button
            type="button"
            onClick={() => submit()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orbit-primary text-white transition hover:brightness-95"
          >
            <Send size={15} />
          </button>
        </div>
      </div>

      {/* 검색 전 안내 */}
      {!isActive && (
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orbit-bg">
            <Sparkles size={20} className="text-orbit-primary" />
          </div>
          <div>
            <p className="text-sm font-medium text-orbit-text">어떤 세션을 찾고 있나요?</p>
            <p className="mt-1 text-xs leading-relaxed text-orbit-muted">
              기억나는 내용을 자유롭게 입력하면<br />유사한 세션을 찾아드려요
            </p>
          </div>
          <div className="w-full space-y-1.5">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => submit(ex)}
                className="block w-full truncate rounded-lg border border-orbit-border px-3 py-1.5 text-left text-[11px] text-orbit-muted transition hover:border-orbit-primary/40 hover:text-orbit-text"
              >
                "{ex}"
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 검색 결과 */}
      {isActive && (
        <section className="space-y-2">
          <p className="text-xs text-orbit-muted">
            {isFetching
              ? rerankEnabled ? 'AI가 결과를 정렬 중…' : '유사한 세션 검색 중…'
              : topResults.length > 0
                ? `유사한 세션 ${topResults.length}개${rerankEnabled ? ' (AI 정렬)' : ''}`
                : '관련 세션을 찾지 못했어요'}
          </p>
          <StatePlaceholder
            loading={isFetching}
            empty={!isFetching && topResults.length === 0}
            emptyText="다른 키워드로 다시 검색해 보세요"
          >
            <div className="space-y-2">
              {topResults.map((session, i) => (
                <SuggestedSessionItem key={session.id} session={session} rank={i + 1} />
              ))}
            </div>
          </StatePlaceholder>
        </section>
      )}
    </div>
  );
}
