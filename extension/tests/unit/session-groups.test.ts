import { describe, expect, it } from 'vitest';
import { groupSessionsByRecency } from '../../lib/session-groups';
import type { Session } from '../../lib/types';

const NOW = new Date('2026-08-12T15:00:00');

function session(id: string, lastActivityAt: string): Session {
  return {
    id,
    title: id,
    tabs: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastActivityAt,
    timeLabel: '8/12 00:00',
    summary: { overview: '', highlights: [], nextActions: [] },
    summaryStatus: 'done',
  } as Session;
}

const isoAtLocalNoon = (year: number, month: number, day: number) =>
  new Date(year, month - 1, day, 12, 0, 0).toISOString();

describe('groupSessionsByRecency', () => {
  it('오늘·어제·지난 7일·지난 30일·그 이전으로 나눈다', () => {
    const groups = groupSessionsByRecency(
      [
        session('today', isoAtLocalNoon(2026, 8, 12)),
        session('yesterday', isoAtLocalNoon(2026, 8, 11)),
        session('week', isoAtLocalNoon(2026, 8, 8)),
        session('month', isoAtLocalNoon(2026, 7, 25)),
        session('older', isoAtLocalNoon(2026, 5, 1)),
      ],
      NOW,
    );

    expect(groups.map((g) => g.label)).toEqual([
      '오늘',
      '어제',
      '지난 7일',
      '지난 30일',
      '그 이전',
    ]);
    expect(groups.map((g) => g.sessions[0].id)).toEqual([
      'today',
      'yesterday',
      'week',
      'month',
      'older',
    ]);
  });

  it('비어 있는 묶음은 내보내지 않는다', () => {
    const groups = groupSessionsByRecency([session('a', isoAtLocalNoon(2026, 8, 12))], NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('오늘');
  });

  it('묶음 안에서 최근 활동 순으로 정렬한다', () => {
    const groups = groupSessionsByRecency(
      [
        session('early', new Date(2026, 7, 12, 9, 0, 0).toISOString()),
        session('late', new Date(2026, 7, 12, 14, 0, 0).toISOString()),
      ],
      NOW,
    );
    expect(groups[0].sessions.map((s) => s.id)).toEqual(['late', 'early']);
  });

  it('lastActivityAt 이 없으면 updatedAt 으로 판단한다', () => {
    const withoutActivity = {
      ...session('snapshot', isoAtLocalNoon(2026, 8, 12)),
      lastActivityAt: undefined,
      updatedAt: isoAtLocalNoon(2026, 8, 11),
    };
    const groups = groupSessionsByRecency([withoutActivity], NOW);
    expect(groups[0].label).toBe('어제');
  });

  it('시계가 어긋나 미래 시각이 와도 오늘로 담는다', () => {
    const groups = groupSessionsByRecency([session('future', isoAtLocalNoon(2026, 8, 20))], NOW);
    expect(groups[0].label).toBe('오늘');
  });
});
