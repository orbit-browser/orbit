import { describe, expect, it } from 'vitest';
import {
  filterTimelineEntries,
  type TimelineEntry,
} from '../../entrypoints/sidepanel/hooks/useTimeline';

function entry(overrides: Partial<TimelineEntry> & { id: string }): TimelineEntry {
  return {
    url: 'https://example.com/page',
    title: '제목 없음',
    domain: 'example.com',
    visitedAt: '2026-08-12T09:00:00.000Z',
    durationMs: 1000,
    isSynced: true,
    badge: { kind: 'synced' },
    ...overrides,
  };
}

const ENTRIES: TimelineEntry[] = [
  entry({ id: '1', title: 'Vite 빌드 설정', domain: 'vitejs.dev', url: 'https://vitejs.dev/config' }),
  entry({
    id: '2',
    title: '리액트 상태관리 비교',
    domain: 'velog.io',
    url: 'https://velog.io/@a/react-state',
  }),
  entry({
    id: '3',
    title: 'orbit 저장소',
    domain: 'github.com',
    url: 'https://github.com/orbit/repo',
    isSynced: false,
    badge: { kind: 'pending' },
  }),
];

describe('filterTimelineEntries', () => {
  it('빈 검색어는 전체를 그대로 돌려준다', () => {
    expect(filterTimelineEntries(ENTRIES, '')).toHaveLength(3);
    expect(filterTimelineEntries(ENTRIES, '   ')).toHaveLength(3);
  });

  it('제목으로 찾는다', () => {
    expect(filterTimelineEntries(ENTRIES, '상태관리').map((e) => e.id)).toEqual(['2']);
  });

  it('도메인으로 찾는다', () => {
    expect(filterTimelineEntries(ENTRIES, 'github').map((e) => e.id)).toEqual(['3']);
  });

  it('URL 경로로 찾는다', () => {
    expect(filterTimelineEntries(ENTRIES, 'react-state').map((e) => e.id)).toEqual(['2']);
  });

  it('대소문자를 구분하지 않는다', () => {
    expect(filterTimelineEntries(ENTRIES, 'VITE').map((e) => e.id)).toEqual(['1']);
  });

  it('아직 동기화 안 된 기록도 걸러낸 결과에 포함한다', () => {
    // Ask 는 서버에 있는 것만 찾으므로, pending 기록을 찾는 유일한 경로가 이 필터다.
    const found = filterTimelineEntries(ENTRIES, 'orbit');
    expect(found).toHaveLength(1);
    expect(found[0].isSynced).toBe(false);
  });

  it('일치가 없으면 빈 배열', () => {
    expect(filterTimelineEntries(ENTRIES, '존재하지않는키워드')).toEqual([]);
  });
});
