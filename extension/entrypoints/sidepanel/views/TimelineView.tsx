import { SyncStatusCard } from '../components/SyncStatusCard';
import { StatePlaceholder } from '../components/StatePlaceholder';
import { TimelineDateHeader } from '../components/timeline/TimelineDateHeader';
import { TimelineItem } from '../components/timeline/TimelineItem';
import { useDeleteTimelineEntry, useTimeline } from '../hooks/useTimeline';
import { useSettingsStore } from '../store/settings';
import { useUIStore } from '../store/ui';

// 사이드패널 기본 화면 — 방문 이벤트를 시간 역순으로 보여준다.
// 계약 근거: docs/IA.md "타임라인 홈", docs/implementation-roadmap.md M4-15.
export function TimelineView() {
  const { groups, isLoading, isError, isEmpty } = useTimeline();
  const { mutate: deleteEntry } = useDeleteTimelineEntry();
  const collectionEnabled = useSettingsStore((s) => s.collectionEnabled);
  const showToast = useUIStore((s) => s.showToast);

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
    </div>
  );
}
