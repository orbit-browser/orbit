import { useState } from 'react';
import { SearchInput } from '../components/SearchInput';
import { SuggestedSessionItem } from '../components/SuggestedSessionItem';
import { StatePlaceholder } from '../components/StatePlaceholder';
import { useSearch } from '../hooks/useSearch';
import { useSessions } from '../hooks/useSessions';
import { useUIStore } from '../store/ui';

export function SearchView() {
  const [query, setQuery] = useState('');
  const submitted = query.trim().length > 0;

  const { data: results, isFetching } = useSearch(query);
  const { data: allSessions } = useSessions();
  const showToast = useUIStore((s) => s.showToast);

  const list = submitted ? results : allSessions;

  return (
    <div className="space-y-4">
      <SearchInput
        placeholder="예: 지난주에 봤던 AI 에이전트 자료 열어줘"
        onSubmit={setQuery}
      />

      <section className="space-y-1">
        <p className="text-xs font-semibold text-orbit-muted">
          {submitted ? '검색 결과' : '추천 세션'}
        </p>
        <StatePlaceholder
          loading={submitted && isFetching}
          empty={submitted && !results?.length}
          emptyText="관련 세션을 찾지 못했어요"
        >
          <div className="space-y-0.5">
            {list?.map((session) => (
              <SuggestedSessionItem key={session.id} session={session} />
            ))}
          </div>
        </StatePlaceholder>
      </section>

      <button
        type="button"
        onClick={() => showToast('전체 검색 결과 (mock)')}
        className="text-xs font-medium text-orbit-primary"
      >
        모든 검색 결과 보기 →
      </button>
    </div>
  );
}
