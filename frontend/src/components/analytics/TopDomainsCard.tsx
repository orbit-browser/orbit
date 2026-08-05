import type { AnalyticsDomainCount } from '../../lib/types';

/** ② 자주 보는 사이트 top5 — 도메인 + 방문 수, 가로 막대로 상대 비율 표시. */
export function TopDomainsCard({ domains }: { domains: AnalyticsDomainCount[] }) {
  const top = domains.slice(0, 5);
  if (top.length === 0) return null;

  const max = Math.max(...top.map((d) => d.visitCount), 1);

  return (
    <div className="rounded-2xl border border-orbit-border bg-orbit-surface p-4">
      <p className="mb-3 text-[13px] font-semibold text-orbit-text">자주 보는 사이트</p>
      <ul className="space-y-2.5">
        {top.map((d) => (
          <li key={d.domain}>
            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate text-orbit-text">{d.domain}</span>
              <span className="shrink-0 text-orbit-muted">{d.visitCount}회</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-orbit-bg">
              <div
                className="h-full rounded-full bg-orbit-primary"
                style={{ width: `${Math.max((d.visitCount / max) * 100, 3)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
