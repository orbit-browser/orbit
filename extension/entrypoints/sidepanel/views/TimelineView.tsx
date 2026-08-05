import { useQuery } from '@tanstack/react-query';
import { SyncStatusCard } from '../components/SyncStatusCard';
import { StatePlaceholder } from '../components/StatePlaceholder';
import { TimelineDateHeader } from '../components/timeline/TimelineDateHeader';
import { TimelineItem } from '../components/timeline/TimelineItem';
import { useDeleteTimelineEntry, useTimeline } from '../hooks/useTimeline';
import { useSettingsStore } from '../store/settings';
import { useUIStore } from '../store/ui';
import { fetchAnalyticsOverview, type AnalyticsOverview } from '../../../lib/api';

// "이번 주 탐색 분석" 요약 카드 — GET /analytics/overview?days=7 (docs/api-design-v2.md §9).
// 집계 실패나 데이터 없음은 오류가 아니라 정상 범위(백엔드 병렬 구현 중)이므로 카드를 조용히 숨긴다.
function formatDuration(ms: number): string {
  const totalMinutes = Math.max(Math.round(ms / 60_000), 0);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}분`;
  if (minutes === 0) return `${hours}시간`;
  return `${hours}시간 ${minutes}분`;
}

function AnalyticsSummaryCard({ overview }: { overview: AnalyticsOverview }) {
  const topSessions = overview.topSessionsByDuration.slice(0, 3);
  const topDomains = overview.topDomains.slice(0, 3);
  if (topSessions.length === 0 && topDomains.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-orbit-border bg-orbit-surface p-3.5">
      <p className="text-xs font-semibold text-orbit-text">이번 주 탐색 분석</p>
      {topSessions.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] font-medium text-orbit-muted">세션별 탐색 시간 top3</p>
          <ul className="space-y-1">
            {topSessions.map((s) => (
              <li key={s.sessionId} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-orbit-text">{s.title}</span>
                <span className="shrink-0 text-orbit-muted">
                  {formatDuration(s.totalActiveDurationMs)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {topDomains.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] font-medium text-orbit-muted">최다 도메인 top3</p>
          <ul className="space-y-1">
            {topDomains.map((d) => (
              <li key={d.domain} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-orbit-text">{d.domain}</span>
                <span className="shrink-0 text-orbit-muted">{d.visitCount}회</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// 사이드패널 기본 화면 — 방문 이벤트를 시간 역순으로 보여준다.
// 계약 근거: docs/IA.md "타임라인 홈", docs/implementation-roadmap.md M4-15.
export function TimelineView() {
  const { groups, isLoading, isError, isEmpty } = useTimeline();
  const { mutate: deleteEntry } = useDeleteTimelineEntry();
  const collectionEnabled = useSettingsStore((s) => s.collectionEnabled);
  const showToast = useUIStore((s) => s.showToast);
  const { data: analytics, isError: analyticsError } = useQuery({
    queryKey: ['orbit-analytics-overview', 7],
    queryFn: () => fetchAnalyticsOverview(7),
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 p-4 pb-2">
        <SyncStatusCard />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <StatePlaceholder
          loading={isLoading}
          error={isError}
          empty={isEmpty}
          emptyText={
            collectionEnabled
              ? '오늘의 탐색이 여기에 기록됩니다'
              : '수집을 켜면 방문 기록이 여기에 쌓여요'
          }
        >
          <div className="space-y-4">
            {groups.map((group) => (
              <section key={group.dateKey}>
                <TimelineDateHeader label={group.label} />
                <div className="space-y-0.5">
                  {group.entries.map((entry) => (
                    <TimelineItem
                      key={entry.id}
                      event={entry}
                      badge={entry.badge}
                      onDelete={() =>
                        deleteEntry(entry, {
                          onSuccess: () => showToast('삭제했어요'),
                          onError: () => showToast('삭제에 실패했어요. 다시 시도해 주세요.'),
                        })
                      }
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </StatePlaceholder>
      </div>

      {!analyticsError && analytics && (
        <div className="shrink-0 px-4 pb-4">
          <AnalyticsSummaryCard overview={analytics} />
        </div>
      )}
    </div>
  );
}
