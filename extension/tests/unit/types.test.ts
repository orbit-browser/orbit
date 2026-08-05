import { describe, expect, it } from 'vitest';
import { domainFromUrl, toWire, type ExplorationEvent } from '../../lib/events/types';

function makeEvent(overrides: Partial<ExplorationEvent> = {}): ExplorationEvent {
  return {
    eventId: 'id-1',
    eventType: 'visit',
    url: 'https://example.com/a',
    title: 'A',
    domain: 'example.com',
    visitedAt: '2026-08-05T00:00:00.000Z',
    endedAt: '2026-08-05T00:01:00.000Z',
    tabId: 7,
    windowId: 3,
    referrerUrl: 'https://google.com',
    previousEventId: 'id-0',
    activeDurationMs: 1234,
    contentExcerpt: '본문',
    createdAt: '2026-08-05T00:00:00.000Z',
    status: 'pending',
    failureCount: 0,
    nextAttemptAt: null,
    syncedAt: null,
    syncingStartedAt: null,
    ...overrides,
  };
}

describe('toWire', () => {
  it('camelCase 필드를 서버 wire(snake_case) 포맷으로 변환한다', () => {
    const wire = toWire(makeEvent());
    expect(wire).toEqual({
      id: 'id-1',
      source: 'browser',
      url: 'https://example.com/a',
      title: 'A',
      visited_at: '2026-08-05T00:00:00.000Z',
      ended_at: '2026-08-05T00:01:00.000Z',
      active_duration_ms: 1234,
      tab_id: 7,
      window_id: 3,
      previous_event_id: 'id-0',
      referrer_url: 'https://google.com',
      event_type: 'visit',
      content_excerpt: '본문',
    });
  });

  it('로컬 전용 상태 필드(status/failureCount 등)는 wire에 포함하지 않는다', () => {
    const wire = toWire(makeEvent()) as unknown as Record<string, unknown>;
    expect(wire.status).toBeUndefined();
    expect(wire.failure_count).toBeUndefined();
    expect(wire.domain).toBeUndefined();
  });

  it('contentExcerpt가 null이면 서버 스키마(str="")에 맞춰 빈 문자열로 치환한다', () => {
    expect(toWire(makeEvent({ contentExcerpt: null })).content_excerpt).toBe('');
  });
});

describe('domainFromUrl', () => {
  it('정상 URL에서 hostname을 추출한다', () => {
    expect(domainFromUrl('https://news.ycombinator.com/item?id=1')).toBe('news.ycombinator.com');
  });

  it('파싱 불가 URL은 빈 문자열을 반환한다', () => {
    expect(domainFromUrl('not-a-url')).toBe('');
  });
});
