import { describe, expect, it } from 'vitest';
import { attachVisits } from '../../lib/session-visits';
import type { SessionTimelineEvent, TabItem } from '../../lib/types';

const tab = (id: string, url: string): TabItem => ({ id, title: id, url });

const event = (
  url: string,
  visitedAt: string,
  sequenceOrder = 0,
): SessionTimelineEvent => ({
  eventId: `${url}-${visitedAt}`,
  url,
  title: url,
  domain: 'example.com',
  visitedAt,
  durationMs: 1000,
  relevanceScore: null,
  sequenceOrder,
});

describe('attachVisits', () => {
  it('처음 본 시각 오름차순으로 세운다 — 세션 안에서는 흐름이 읽혀야 한다', () => {
    const result = attachVisits(
      [tab('a', 'https://a.com'), tab('b', 'https://b.com')],
      [
        event('https://b.com', '2026-08-12T09:00:00.000Z'),
        event('https://a.com', '2026-08-12T10:00:00.000Z'),
      ],
    );
    expect(result.map((r) => r.tab.id)).toEqual(['b', 'a']);
  });

  it('같은 페이지를 여러 번 봐도 한 줄이고 횟수로 센다', () => {
    const result = attachVisits(
      [tab('a', 'https://a.com')],
      [
        event('https://a.com', '2026-08-12T10:00:00.000Z'),
        event('https://a.com', '2026-08-12T11:00:00.000Z'),
        event('https://a.com', '2026-08-12T12:00:00.000Z'),
      ],
    );
    expect(result).toHaveLength(1);
    expect(result[0].visits).toBe(3);
  });

  it('처음 본 시각은 이벤트 순서와 무관하게 가장 이른 값이다', () => {
    const result = attachVisits(
      [tab('a', 'https://a.com')],
      [
        event('https://a.com', '2026-08-12T12:00:00.000Z'),
        event('https://a.com', '2026-08-12T09:00:00.000Z'),
      ],
    );
    expect(result[0].firstVisitAt).toBe('2026-08-12T09:00:00.000Z');
  });

  it('이벤트가 없는 탭은 원래 순서로 뒤에 붙인다', () => {
    const result = attachVisits(
      [tab('a', 'https://a.com'), tab('b', 'https://b.com'), tab('c', 'https://c.com')],
      [event('https://b.com', '2026-08-12T09:00:00.000Z')],
    );
    expect(result.map((r) => r.tab.id)).toEqual(['b', 'a', 'c']);
    expect(result[1].firstVisitAt).toBeNull();
    expect(result[1].visits).toBe(0);
  });

  it('이벤트가 전혀 없으면 탭 목록을 그대로 돌려준다 — 조회 실패가 목록을 지우면 안 된다', () => {
    const tabs = [tab('a', 'https://a.com'), tab('b', 'https://b.com')];
    const result = attachVisits(tabs, []);
    expect(result.map((r) => r.tab.id)).toEqual(['a', 'b']);
    expect(result.every((r) => r.firstVisitAt === null)).toBe(true);
  });
});
