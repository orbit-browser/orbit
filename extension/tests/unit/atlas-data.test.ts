import { describe, expect, it } from 'vitest';
import type { Folder, Session, SessionTimelineEvent } from '../../lib/types';
import {
  buildAtlasSessions,
  buildFolderNodes,
  buildFolderScene,
  buildSessionScene,
  isVisibleSlot,
  mostRevisitedPage,
  normalizeRotation,
  orbitSlot,
  ORBIT_CAPACITY,
  ORBIT_VISIBLE_SLOTS,
  splitPagesIntoOrbits,
  toSessionNode,
  visibleIndices,
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

  it('페이지를 궤도 정원만큼 방문 순서대로 나눈다', () => {
    expect(splitPagesIntoOrbits([])).toEqual([]);

    const full = Array.from({ length: ORBIT_CAPACITY }, (_, index) => index);
    expect(splitPagesIntoOrbits(full)).toEqual([full]);

    const overflow = Array.from({ length: ORBIT_CAPACITY + 1 }, (_, index) => index);
    expect(splitPagesIntoOrbits(overflow)).toEqual([full, [ORBIT_CAPACITY]]);
  });

  it('궤도당 페이지 제한은 1 이상이어야 한다', () => {
    expect(() => splitPagesIntoOrbits([1], 0)).toThrow('Orbit page limit must be at least 1');
  });
});

describe('궤도 슬롯과 회전', () => {
  it('회전이 없으면 앞면 슬롯 수만큼만 보인다', () => {
    expect(visibleIndices(ORBIT_CAPACITY, 0)).toEqual(
      Array.from({ length: ORBIT_VISIBLE_SLOTS }, (_, index) => index),
    );
  });

  it('정원을 넘지 않는 점은 모두 앞면 슬롯에 들어간다', () => {
    for (let index = 0; index < ORBIT_VISIBLE_SLOTS; index += 1) {
      expect(isVisibleSlot(orbitSlot(index, 0, ORBIT_CAPACITY))).toBe(true);
    }
  });

  it('앞면 슬롯을 넘긴 점은 뒤편으로 넘어가 보이지 않는다', () => {
    expect(isVisibleSlot(orbitSlot(ORBIT_VISIBLE_SLOTS, 0, ORBIT_CAPACITY))).toBe(false);
  });

  it('한 칸 회전하면 앞면 첫 점이 뒤로 가고 뒤편 점이 하나 올라온다', () => {
    const before = visibleIndices(ORBIT_CAPACITY, 0);
    const after = visibleIndices(ORBIT_CAPACITY, 1);

    expect(after).not.toContain(before[0]);
    expect(after).toContain(before[before.length - 1] + 1);
    expect(after).toHaveLength(before.length);
  });

  it('음수 회전도 앞면 슬롯 수를 유지한다', () => {
    expect(visibleIndices(ORBIT_CAPACITY, -1)).toHaveLength(ORBIT_VISIBLE_SLOTS);
  });

  it('점이 앞면 슬롯보다 적으면 회전과 무관하게 전부 보인다', () => {
    expect(visibleIndices(3, 0)).toEqual([0, 1, 2]);
    expect(visibleIndices(3, 2)).toHaveLength(3);
  });

  it('슬롯 번호는 항상 0 이상 total 미만이다', () => {
    for (const rotation of [-20, -1, 0, 5, 137]) {
      const slot = orbitSlot(3, rotation, ORBIT_CAPACITY);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(ORBIT_CAPACITY);
    }
  });

  it('회전량은 아이템 수 안에서 순환한다', () => {
    expect(normalizeRotation(0, 5)).toBe(0);
    expect(normalizeRotation(5, 5)).toBe(0);
    expect(normalizeRotation(-1, 5)).toBe(4);
    expect(normalizeRotation(7, 5)).toBe(2);
  });

  it('빈 궤도의 회전량은 0으로 고정된다', () => {
    expect(normalizeRotation(3, 0)).toBe(0);
  });
});

describe('캔버스 씬 구성', () => {
  function folder(overrides: Partial<Folder> = {}): Folder {
    return {
      id: 'folder-1',
      name: '논문 리서치',
      hue: '#ef6f47',
      position: 0,
      sessionCount: 0,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      ...overrides,
    };
  }

  it('폴더 씬은 세션 하나를 궤도 한 줄로 만든다', () => {
    const first = toSessionNode(session({ id: 'a', title: '세션 A' }), [event()], NOW);
    const second = toSessionNode(session({ id: 'b', title: '세션 B' }), [], NOW);

    const scene = buildFolderScene({
      id: 'folder-1',
      name: '논문 리서치',
      hue: '#ef6f47',
      position: 0,
      sessions: [first, second],
    });

    expect(scene.kind).toBe('folder');
    expect(scene.title).toBe('논문 리서치');
    expect(scene.tracks).toHaveLength(2);
    expect(scene.tracks.map((track) => track.sessionId)).toEqual(['a', 'b']);
    expect(scene.tracks[0].points.map((point) => point.id)).toEqual(['event-1']);
  });

  it('폴더 씬의 궤도에는 칩 메타가 붙고 세션 씬에는 붙지 않는다', () => {
    // 칩이 있으면 궤도 최하단이 칩 자리라 캔버스가 점을 좌우로 갈라 놓는다.
    const node = toSessionNode(session({ id: 'a' }), [event()], NOW);

    const folderScene = buildFolderScene({
      id: 'folder-1',
      name: '논문 리서치',
      hue: '#ef6f47',
      position: 0,
      sessions: [node],
    });
    expect(folderScene.tracks[0].chip).toEqual({
      date: node.date,
      minutes: node.minutes,
      status: node.status,
    });

    expect(buildSessionScene(node).tracks[0].chip).toBeNull();
  });

  it('세션 씬은 페이지를 궤도 정원 단위로 나눈다', () => {
    const events = Array.from({ length: ORBIT_CAPACITY + 2 }, (_, index) =>
      event({ eventId: `event-${index}`, sequenceOrder: index, url: `https://x/${index}` }),
    );
    const scene = buildSessionScene(toSessionNode(session(), events, NOW));

    expect(scene.kind).toBe('session');
    expect(scene.tracks).toHaveLength(2);
    expect(scene.tracks[0].points).toHaveLength(ORBIT_CAPACITY);
    expect(scene.tracks[1].points).toHaveLength(2);
    expect(scene.tracks.every((track) => track.sessionId === null)).toBe(true);
  });

  it('궤도가 하나뿐인 세션 씬은 궤도 라벨을 비운다', () => {
    // 중심 노드 아래에 이미 같은 제목이 있어 라벨을 달면 글자가 겹친다.
    const scene = buildSessionScene(toSessionNode(session(), [event()], NOW));

    expect(scene.tracks).toHaveLength(1);
    expect(scene.tracks[0].label).toBe('');
  });

  it('궤도가 여러 개면 순번 라벨을 붙인다', () => {
    const events = Array.from({ length: ORBIT_CAPACITY + 1 }, (_, index) =>
      event({ eventId: `event-${index}`, sequenceOrder: index, url: `https://x/${index}` }),
    );
    const scene = buildSessionScene(toSessionNode(session(), events, NOW));

    expect(scene.tracks.map((track) => track.label)).toEqual(['1번째 궤도', '2번째 궤도']);
  });

  it('세션을 폴더별로 나누고 소속 없는 세션은 미정리로 남긴다', () => {
    const filed = toSessionNode(session({ id: 'filed', folderId: 'folder-1' }), [], NOW);
    const loose = toSessionNode(session({ id: 'loose' }), [], NOW);

    const grouped = buildFolderNodes([folder()], [filed, loose]);

    expect(grouped.folders).toHaveLength(1);
    expect(grouped.folders[0].sessions.map((item) => item.id)).toEqual(['filed']);
    expect(grouped.unfiled.map((item) => item.id)).toEqual(['loose']);
  });

  it('사라진 폴더를 가리키는 세션은 미정리로 되돌린다', () => {
    const orphan = toSessionNode(session({ id: 'orphan', folderId: 'deleted' }), [], NOW);

    const grouped = buildFolderNodes([folder()], [orphan]);

    expect(grouped.folders[0].sessions).toEqual([]);
    expect(grouped.unfiled.map((item) => item.id)).toEqual(['orphan']);
  });

  it('폴더는 position 순서로 정렬한다', () => {
    const grouped = buildFolderNodes(
      [
        folder({ id: 'second', name: '나중', position: 2 }),
        folder({ id: 'first', name: '먼저', position: 1 }),
      ],
      [],
    );

    expect(grouped.folders.map((item) => item.id)).toEqual(['first', 'second']);
  });
});
