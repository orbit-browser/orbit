import type { AnalyticsSessionDuration } from '../../lib/types';
import { formatDuration } from './format';

/** ① 세션(주제)별 탐색 시간 top5 — 최댓값 대비 비율 폭의 가로 막대. */
export function TopSessionsCard({ sessions }: { sessions: AnalyticsSessionDuration[] }) {
  const top = sessions.slice(0, 5);
  if (top.length === 0) return null;

  const max = Math.max(...top.map((s) => s.totalActiveDurationMs), 1);

  return (
    <div className="rounded-2xl border border-orbit-border bg-orbit-surface p-4">
      <p className="mb-3 text-[13px] font-semibold text-orbit-text">세션별 탐색 시간</p>
      <ul className="space-y-2.5">
        {top.map((s) => (
          <li key={s.sessionId}>
            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate text-orbit-text">{s.title}</span>
              <span className="shrink-0 text-orbit-muted">
                {formatDuration(s.totalActiveDurationMs)}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-orbit-bg">
              <div
                className="h-full rounded-full bg-orbit-primary"
                style={{ width: `${Math.max((s.totalActiveDurationMs / max) * 100, 3)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
