import type { Session } from './types';

export interface SessionGroup {
  key: string;
  label: string;
  sessions: Session[];
}

/**
 * 세션이 "언제 것"인지 판단하는 기준 시각.
 *
 * append 로 자라는 Auto Session 은 만들어진 때가 아니라 **마지막으로 손댄 때**가
 * 사용자 기억과 맞는다 — 목록 정렬·묶음 모두 이 값을 쓴다.
 */
function activityAt(session: Session): number {
  return new Date(session.lastActivityAt ?? session.updatedAt ?? session.createdAt).getTime();
}

function startOfDay(time: number): number {
  const d = new Date(time);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

const DAY_MS = 86_400_000;

/**
 * 최근순 묶음. 날짜별로 쪼개면 하루 한 개짜리 그룹이 줄줄이 생겨 목록이 더 산만해지므로,
 * 굵은 구간 다섯 개로만 나눈다.
 */
export function groupSessionsByRecency(sessions: Session[], now = new Date()): SessionGroup[] {
  const today = startOfDay(now.getTime());
  const buckets: SessionGroup[] = [
    { key: 'today', label: '오늘', sessions: [] },
    { key: 'yesterday', label: '어제', sessions: [] },
    { key: 'week', label: '지난 7일', sessions: [] },
    { key: 'month', label: '지난 30일', sessions: [] },
    { key: 'older', label: '그 이전', sessions: [] },
  ];

  const sorted = [...sessions].sort((a, b) => activityAt(b) - activityAt(a));
  for (const session of sorted) {
    const days = Math.floor((today - startOfDay(activityAt(session))) / DAY_MS);
    // 시계가 어긋나 미래 시각이 들어와도 '오늘'로 담는다 — 빈 그룹으로 새지 않게.
    if (days <= 0) buckets[0].sessions.push(session);
    else if (days === 1) buckets[1].sessions.push(session);
    else if (days < 7) buckets[2].sessions.push(session);
    else if (days < 30) buckets[3].sessions.push(session);
    else buckets[4].sessions.push(session);
  }

  return buckets.filter((bucket) => bucket.sessions.length > 0);
}
