import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Compass, Globe2 } from 'lucide-react';
import { fetchAnalyticsOverview, fetchRecommendations } from '../../../../lib/api';
import { WidgetStrip, WidgetTile } from './WidgetFrame';
import { useTimeline } from '../../hooks/useTimeline';
import { useUIStore } from '../../store/ui';

/**
 * 추천 세션 — 서버가 캐시를 돌려주므로 한 번만 부르고, 화면에서 천천히 돌려 보인다.
 * 회전은 받아 둔 목록을 바꿔 그리는 것이라 추가 호출이 없다.
 */
export function RecommendWidget() {
  const openSession = useUIStore((s) => s.openSession);
  const [index, setIndex] = useState(0);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['orbit-recommendations', 'sidepanel'],
    queryFn: () => fetchRecommendations(),
    staleTime: 5 * 60_000,
  });

  const items = data?.items ?? [];

  useEffect(() => {
    if (items.length < 2) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % items.length), 12_000);
    return () => clearInterval(timer);
  }, [items.length]);

  const current = items.length > 0 ? items[index % items.length] : null;

  return (
    <WidgetTile
      icon={<Compass size={16} />}
      title="추천 세션"
      status={
        current
          ? current.title
          : isError
            ? '오류'
            : isLoading
              ? '고르는 중'
              : '기록이 더 필요해요'
      }
      active={!!current}
      expandable={!!current}
      ariaLabel={current ? `추천 세션 ${current.title} 열기` : '추천 세션'}
      onClick={current ? () => openSession(current.sessionId) : undefined}
    />
  );
}

/** 최다 도메인 — 이번 주 1위 도메인만 짧게 보여준다. */
export function TopDomainsWidget() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['orbit-analytics-overview', 7],
    queryFn: () => fetchAnalyticsOverview(7),
  });
  const openSheet = useUIStore((s) => s.openSheet);
  const top = data?.topDomains[0];

  return (
    <WidgetTile
      icon={<Globe2 size={16} />}
      title="최다 도메인"
      status={
        top ? `${top.domain} ${top.visitCount}회` : isError ? '오류' : isLoading ? '집계 중' : '기록 없음'
      }
      active={!!top}
      expandable
      ariaLabel="이번 주 최다 도메인 — 타임라인 열기"
      onClick={() => openSheet({ kind: 'timeline' })}
    />
  );
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/**
 * 오늘의 탐색 — 시간대별 방문 막대.
 * 이미 화면이 들고 있는 타임라인 데이터를 다시 쓰므로 추가 요청이 없다.
 */
export function TodayActivityWidget() {
  const { groups } = useTimeline();
  const openSheet = useUIStore((s) => s.openSheet);

  const { buckets, total } = useMemo(() => {
    const today = groups.find((group) => group.label === '오늘');
    const counts = new Array(24).fill(0) as number[];
    for (const entry of today?.entries ?? []) {
      const hour = new Date(entry.visitedAt).getHours();
      if (hour >= 0 && hour < 24) counts[hour] += 1;
    }
    return { buckets: counts, total: counts.reduce((acc, n) => acc + n, 0) };
  }, [groups]);

  const max = Math.max(...buckets, 1);
  const currentHour = new Date().getHours();

  return (
    <WidgetStrip onClick={() => openSheet({ kind: 'timeline' })} ariaLabel="오늘의 탐색 — 타임라인 열기">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <Activity size={12} className="text-orbit-primary" aria-hidden />
          <span className="text-[11px] font-bold text-orbit-text">오늘의 탐색</span>
        </span>
        <span className="shrink-0 text-[10px] text-orbit-muted">
          {total > 0 ? `${total}회` : '기록 없음'}
        </span>
      </div>

      <div className="flex h-4 items-end gap-[2px]" aria-hidden>
        {HOURS.map((hour) => (
          <span
            key={hour}
            style={{ height: `${Math.max((buckets[hour] / max) * 100, 8)}%` }}
            className={
              'flex-1 rounded-full transition-all duration-500 ' +
              (buckets[hour] === 0
                ? 'bg-orbit-disc-off'
                : hour === currentHour
                  ? 'bg-orbit-primary'
                  : 'bg-orbit-primary/55')
            }
          />
        ))}
      </div>
    </WidgetStrip>
  );
}
