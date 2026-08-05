import type { AnalyticsDailyTrendPoint } from '../../lib/types';
import { formatDuration, formatShortDate } from './format';

/** ④ 일별 탐색량(최근 7일) — 세로 CSS 막대만 사용(차트 라이브러리 금지). */
export function DailyTrendCard({ trend }: { trend: AnalyticsDailyTrendPoint[] }) {
  if (trend.length === 0) return null;

  const max = Math.max(...trend.map((d) => d.eventCount), 1);

  return (
    <div className="rounded-2xl border border-orbit-border bg-orbit-surface p-4">
      <p className="mb-3 text-[13px] font-semibold text-orbit-text">일별 탐색량</p>
      <div className="flex h-28 items-end gap-2">
        {trend.map((d) => (
          <div
            key={d.date}
            className="flex h-full flex-1 flex-col items-center gap-1.5"
            title={`${formatShortDate(d.date)} · 방문 ${d.eventCount}회 · ${formatDuration(d.totalActiveDurationMs)}`}
          >
            <div className="flex w-full flex-1 items-end">
              <div
                className="w-full rounded-t-md bg-orbit-primary"
                style={{ height: `${Math.max((d.eventCount / max) * 100, 4)}%` }}
              />
            </div>
            <span className="text-[10px] text-orbit-muted">{formatShortDate(d.date)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
