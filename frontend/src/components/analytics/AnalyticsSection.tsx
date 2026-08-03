import { useAnalyticsOverview } from '../../hooks/useAnalytics';
import { TopSessionsCard } from './TopSessionsCard';
import { TopDomainsCard } from './TopDomainsCard';
import { RepeatListCard } from './RepeatListCard';
import { DailyTrendCard } from './DailyTrendCard';

/**
 * "탐색 분석" 섹션 — GET /analytics/overview (docs/api-design-v2.md §9).
 * 백엔드가 병렬 구현 중이라 실패하거나 일부 필드가 비어 있을 수 있다 — 그런 경우
 * 섹션 전체 혹은 데이터가 없는 카드만 조용히 숨긴다(기존 화면과 독립적으로 배포 가능).
 */
export function AnalyticsSection() {
  const { data, isLoading, isError } = useAnalyticsOverview(7);

  if (isLoading || isError || !data) return null;

  const hasAnyData =
    data.topSessionsByDuration.length > 0 ||
    data.topDomains.length > 0 ||
    data.repeatVisits.length > 0 ||
    data.repeatSearchQueries.length > 0 ||
    data.dailyTrend.length > 0;

  if (!hasAnyData) return null;

  return (
    <div className="mt-16 w-full max-w-[860px]">
      <h2 className="mb-4 text-[15px] font-semibold text-orbit-text">탐색 분석</h2>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <TopSessionsCard sessions={data.topSessionsByDuration} />
        <TopDomainsCard domains={data.topDomains} />
        <RepeatListCard visits={data.repeatVisits} queries={data.repeatSearchQueries} />
        <DailyTrendCard trend={data.dailyTrend} />
      </div>
    </div>
  );
}
