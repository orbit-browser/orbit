import { useState } from 'react';
import { Search } from 'lucide-react';
import { useSearch } from '../hooks/useSessions';
import { SessionCard } from '../components/SessionCard';

export function SearchView() {
  const [query, setQuery] = useState('');
  const { data: results, isLoading } = useSearch(query);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-orbit-muted"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="자연어로 세션을 검색하세요…"
          className="w-full rounded-xl border border-orbit-border bg-orbit-surface py-2.5 pl-9 pr-4 text-sm outline-none transition focus:border-orbit-primary"
        />
      </div>

      {isLoading && <p className="text-sm text-orbit-muted">검색 중…</p>}

      {results && results.length === 0 && query.trim() && (
        <p className="text-sm text-orbit-muted">검색 결과가 없어요</p>
      )}

      {results && results.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((session) => (
            <SessionCard key={session.id} session={session} />
          ))}
        </div>
      )}
    </div>
  );
}
