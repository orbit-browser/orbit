import { describe, expect, it } from 'vitest';
import type { Session, SessionTimelineEvent } from '../../lib/types';
import {
  buildAtlasSessions,
  mostRevisitedPage,
  splitPagesIntoOrbits,
  toSessionNode,
} from '../../entrypoints/newtab/components/atlas/data';

const NOW = new Date('2026-08-07T12:00:00.000Z');

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    title: '실제 탐색 세션',
    tabs: [
      { id: '11', title: 'Orbit 문서', url: 'https://docs.example.com/orbit' },
    ],
    createdAt: '2026-08-07T09:00:00.000Z',
    updatedAt: '2026-08-07T09:30:00.000Z',
    lastActivityAt: '2026-08-07T11:45:00.000Z',
    timeLabel: '8/7 20:45',
    summary: {
      overview: '세션 개요',
      highlights: ['핵심 정보'],
      nextActions: ['다음 행동'],
    },
    summaryStatus: 'done',
    ...overrides,
  };
}

function event(overrides: Partial<SessionTimelineEvent> = {}): SessionTimelineEvent {
  return {
    eventId: 'event-1',
    url: 'https://example.com/a',
    title: '첫 페이지',
    domain: 'example.com',
    visitedAt: '2026-08-07T11:00:00.000Z',
    durationMs: 90_000,
    relevanceScore: null,
    sequenceOrder: 1,
    ...overrides,
  };
}

describe('newtab Atlas data mapping', () => {
  it('페이지 이벤트를 시간 순서대로 유지하고 같은 URL의 방문 횟수를 표시한다', () => {
    const events = [
      event({ eventId: 'event-2', sequenceOrder: 2, durationMs: 30_000 }),
      event({ eventId: 'event-1', sequenceOrder: 1, durationMs: 90_000 }),
      event({
        eventId: 'event-3',
        sequenceOrder: 3,
        url: 'https://other.example.com',
        domain: 'other.example.com',
        title: '다른 페이지',
      }),
    ];

    const mapped = toSessionNode(session(), events, NOW);

    expect(mapped.pages.map((page) => page.id)).toEqual(['event-1', 'event-2', 'event-3']);
    expect(mapped.pages.map((page) => page.visits)).toEqual([2, 2, 1]);
    expect(mapped.pages.map((page) => page.minutes)).toEqual([2, 1, 2]);
    expect(mapped.minutes).toBe(4);
    expect(mapped.status).toBe('live');
  });

  it('이벤트가 없는 snapshot 세션은 탭 목록으로 보완한다', () => {
    const mapped = toSessionNode(session(), [], NOW);

    expect(mapped.pages).toEqual([
      {
        id: '11',
        title: 'Orbit 문서',
        url: 'https://docs.example.com/orbit',
        domain: 'DOCS.EXAMPLE.COM',
        minutes: 0,
        visits: 1,
      },
    ]);
  });

  it('세션을 마지막 활동 시각의 최신순으로 정렬한다', () => {
    const older = session({
      id: 'older',
      lastActivityAt: '2026-08-01T10:00:00.000Z',
    });
    const newer = session({
      id: 'newer',
      lastActivityAt: '2026-08-07T11:50:00.000Z',
    });

    const mapped = buildAtlasSessions([older, newer], new Map(), NOW);

    expect(mapped.map((item) => item.id)).toEqual(['newer', 'older']);
    expect(mapped[0].status).toBe('live');
    expect(mapped[1].status).toBe('recent');
  });

  it('페이지가 없는 세션의 재방문 helper는 null을 반환한다', () => {
    const mapped = toSessionNode(session({ tabs: [] }), [], NOW);
    expect(mostRevisitedPage(mapped)).toBeNull();
  });

  it('페이지를 최대 8개씩 방문 순서대로 궤도에 나눈다', () => {
    expect(splitPagesIntoOrbits([])).toEqual([]);
    expect(splitPagesIntoOrbits(Array.from({ length: 8 }, (_, index) => index))).toEqual([
      [0, 1, 2, 3, 4, 5, 6, 7],
    ]);
    expect(splitPagesIntoOrbits(Array.from({ length: 17 }, (_, index) => index))).toEqual([
      [0, 1, 2, 3, 4, 5, 6, 7],
      [8, 9, 10, 11, 12, 13, 14, 15],
      [16],
    ]);
  });

  it('궤도당 페이지 제한은 1 이상이어야 한다', () => {
    expect(() => splitPagesIntoOrbits([1], 0)).toThrow('Orbit page limit must be at least 1');
  });
});
