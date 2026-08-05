import type { AnalyticsRepeatSearchQuery, AnalyticsRepeatVisit } from '../../lib/types';

interface Props {
  visits: AnalyticsRepeatVisit[];
  queries: AnalyticsRepeatSearchQuery[];
}

/** ③ 반복 방문 페이지 / 반복 검색어 리스트. 둘 중 한쪽만 있어도 부드럽게 표시한다. */
export function RepeatListCard({ visits, queries }: Props) {
  const topVisits = visits.slice(0, 5);
  const topQueries = queries.slice(0, 5);
  if (topVisits.length === 0 && topQueries.length === 0) return null;

  return (
    <div className="rounded-2xl border border-orbit-border bg-orbit-surface p-4">
      <p className="mb-3 text-[13px] font-semibold text-orbit-text">반복 방문 · 검색</p>
      <div className="space-y-4">
        {topVisits.length > 0 && (
          <div>
            <p className="mb-1.5 text-[11px] font-medium text-orbit-muted">자주 다시 찾은 페이지</p>
            <ul className="space-y-1.5">
              {topVisits.map((v) => (
                <li key={v.normalizedUrl} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate text-orbit-text">
                    {v.title || v.normalizedUrl}
                  </span>
                  <span className="shrink-0 rounded-full bg-orbit-bg px-1.5 py-0.5 text-[11px] text-orbit-muted">
                    {v.visitCount}회
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {topQueries.length > 0 && (
          <div>
            <p className="mb-1.5 text-[11px] font-medium text-orbit-muted">반복 검색어</p>
            <ul className="space-y-1.5">
              {topQueries.map((q) => (
                <li key={q.searchQuery} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate text-orbit-text">{q.searchQuery}</span>
                  <span className="shrink-0 rounded-full bg-orbit-bg px-1.5 py-0.5 text-[11px] text-orbit-muted">
                    {q.count}회
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
