import { describe, expect, it } from 'vitest';
import type { Folder, Session, SessionTimelineEvent } from '../../lib/types';
import type { SessionNode } from '../../entrypoints/newtab/components/atlas/data';
import {
  buildAtlasSessions,
  buildFolderNodes,
  buildFolderScene,
  buildSessionScene,
  alignOffset,
  buildNavRows,
  folderTopDomains,
  folderTotals,
  largestSession,
  mostRevisitedPage,
  normalizeRotation,
  ORBIT_RING_HINTS,
  ORBIT_RING_SIDE,
  orbitPlacement,
  ORBIT_VISIBLE_COUNT,
  ringDelta,
  ringPlacement,
  sortSessions,
  stepNavRow,
  toSessionNode,
} from '../../entrypoints/newtab/components/atlas/data';

const NOW = new Date('2026-08-07T12:00:00.000Z');

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    title: '실제 탐색 세션',
    alias: null,
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

  it('별칭이 있으면 그것이 표시 이름이고, 원본은 alias 로 따로 남는다', () => {
    // 서버가 응답 경계에서 이미 합쳐 준다 — 클라이언트는 다시 고르지 않는다.
    const mapped = toSessionNode(session({ title: '졸업논문 실험', alias: '졸업논문 실험' }), [], NOW);

    expect(mapped.title).toBe('졸업논문 실험');
    expect(mapped.alias).toBe('졸업논문 실험');
  });

  it('별칭이 없으면 alias 는 null 이다', () => {
    expect(toSessionNode(session(), [], NOW).alias).toBeNull();
  });

  it('페이지가 없는 세션의 재방문 helper는 null을 반환한다', () => {
    const mapped = toSessionNode(session({ tabs: [] }), [], NOW);
    expect(mostRevisitedPage(mapped)).toBeNull();
  });

});

describe('네비게이터 정렬', () => {
  const node = (id: string, title: string) =>
    toSessionNode(session({ id, title }), [], NOW);

  it('최신순은 들어온 순서를 그대로 둔다', () => {
    // buildAtlasSessions 가 이미 마지막 활동 시각 내림차순으로 만들어 둔다.
    const list = [node('a', '나중'), node('b', '가장 오래됨')];

    expect(sortSessions(list, 'recent').map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('가나다순은 표시 이름 기준으로 한글을 정렬한다', () => {
    const list = [node('c', '다항식'), node('a', '가우시안'), node('b', '나비에')];

    expect(sortSessions(list, 'title').map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('가나다순은 숫자를 사전순이 아니라 크기순으로 본다', () => {
    const list = [node('b', '실험 10'), node('a', '실험 2')];

    expect(sortSessions(list, 'title').map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('정렬은 원본 배열을 바꾸지 않는다', () => {
    const list = [node('b', '나'), node('a', '가')];
    const before = list.map((item) => item.id);

    sortSessions(list, 'title');

    expect(list.map((item) => item.id)).toEqual(before);
  });

  it('빈 목록도 안전하다', () => {
    expect(sortSessions([], 'title')).toEqual([]);
    expect(sortSessions([], 'recent')).toEqual([]);
  });
});

describe('폴더 집계', () => {
  const pagedSession = (id: string, domains: string[]) =>
    toSessionNode(
      session({ id, title: id }),
      domains.map((domain, index) =>
        event({
          eventId: `${id}-${index}`,
          sequenceOrder: index,
          url: `https://${domain}/${index}`,
          domain,
          durationMs: 60_000,
        }),
      ),
      NOW,
    );

  const folder = (sessions: SessionNode[]) => ({
    id: 'f1',
    name: '폴더',
    hue: '#ef6f47',
    position: 0,
    sessions,
  });

  it('세션·페이지·시간을 합산한다', () => {
    const node = folder([
      pagedSession('a', ['x.test', 'y.test']),
      pagedSession('b', ['x.test']),
    ]);

    expect(folderTotals(node)).toEqual({ sessionCount: 2, pageCount: 3, minutes: 3 });
  });

  it('빈 폴더는 모두 0 이다', () => {
    expect(folderTotals(folder([]))).toEqual({ sessionCount: 0, pageCount: 0, minutes: 0 });
  });

  it('도메인은 폴더 전체에서 세어 많은 순으로 준다', () => {
    const node = folder([
      pagedSession('a', ['x.test', 'y.test']),
      pagedSession('b', ['x.test']),
    ]);

    expect(folderTopDomains(node)).toEqual([
      { domain: 'X.TEST', count: 2 },
      { domain: 'Y.TEST', count: 1 },
    ]);
  });

  it('도메인 동률은 이름순으로 갈라 결과가 흔들리지 않는다', () => {
    const node = folder([pagedSession('a', ['b.test', 'a.test'])]);

    expect(folderTopDomains(node).map((d) => d.domain)).toEqual(['A.TEST', 'B.TEST']);
  });

  it('대표 세션은 페이지가 가장 많은 세션이다', () => {
    const node = folder([
      pagedSession('a', ['x.test']),
      pagedSession('b', ['x.test', 'y.test', 'z.test']),
    ]);

    expect(largestSession(node)?.id).toBe('b');
    expect(largestSession(folder([]))).toBeNull();
  });
});

describe('궤도(링) 배치', () => {
  /** 지금 그려지는 궤도들. */
  const rendered = (total: number, focus: number) =>
    Array.from({ length: total }, (_, index) => ringPlacement(index, focus, total)).filter(
      (placement): placement is NonNullable<typeof placement> => placement !== null,
    );

  it('초점 궤도는 언제나 같은 자리(offset 0)에 온다', () => {
    for (const [total, focus] of [[1, 0], [3, 1], [12, 7]] as const) {
      expect(ringPlacement(focus, focus, total)?.offset).toBe(0);
    }
  });

  it('안쪽 이웃은 음수, 바깥 이웃은 양수 쪽으로 간다', () => {
    expect(ringPlacement(4, 5, 12)!.offset).toBeLessThan(0);
    expect(ringPlacement(6, 5, 12)!.offset).toBeGreaterThan(0);
  });

  it('초점을 축으로 좌우 대칭이다', () => {
    const inner = ringPlacement(4, 5, 12)!;
    const outer = ringPlacement(6, 5, 12)!;
    expect(-inner.offset).toBeCloseTo(outer.offset, 10);
  });

  it('온전한 구간 밖은 간격이 눌려 붙는다', () => {
    // 흐린 궤도가 온전한 궤도와 같은 간격이면 "밖" 이라는 신호가 되지 않는다.
    const full = ringPlacement(6, 5, 12)!;
    const first = ringPlacement(7, 5, 12)!;
    const second = ringPlacement(8, 5, 12)!;

    expect(first.offset - full.offset).toBeLessThan(full.offset);
    expect(second.offset - first.offset).toBeCloseTo(first.offset - full.offset, 10);
  });

  it('세션이 많아도 그리는 궤도 수는 고정된다', () => {
    const placements = rendered(30, 15);

    expect(placements).toHaveLength((ORBIT_RING_SIDE + ORBIT_RING_HINTS) * 2 + 1);
    expect(placements.filter((placement) => placement.beyond === 0)).toHaveLength(
      ORBIT_RING_SIDE * 2 + 1,
    );
    // 양 끝에 "더 있다"는 흐린 궤도가 남는다.
    expect(placements.filter((placement) => placement.beyond > 0)).toHaveLength(
      ORBIT_RING_HINTS * 2,
    );
  });

  it('세션이 적으면 전부 온전히 보인다', () => {
    const placements = rendered(ORBIT_RING_SIDE * 2 + 1, ORBIT_RING_SIDE);

    expect(placements.every((placement) => placement.beyond === 0)).toBe(true);
  });

  it('초점에서 너무 먼 궤도는 그리지 않는다', () => {
    expect(ringPlacement(0, 20, 30)).toBeNull();
  });

  it('목록 밖 인덱스와 빈 목록은 자리가 없다', () => {
    expect(ringPlacement(-1, 0, 3)).toBeNull();
    expect(ringPlacement(3, 0, 3)).toBeNull();
    expect(ringPlacement(0, 0, 0)).toBeNull();
  });
});

describe('네비게이터 세로 이동', () => {
  const node = (id: string) => toSessionNode(session({ id }), [], NOW);
  const folderNode = (id: string, sessionIds: string[]) => ({
    id,
    name: id,
    hue: '#ef6f47',
    position: 0,
    sessions: sessionIds.map(node),
  });

  const folders = [folderNode('f1', ['a1', 'a2']), folderNode('f2', ['b1'])];
  const unfiled = [node('u1'), node('u2')];

  it('폴더를 보고 있지 않으면 폴더 줄과 미정리 세션만 이어진다', () => {
    expect(buildNavRows(folders, unfiled, null)).toEqual([
      { folderId: 'f1', sessionId: null },
      { folderId: 'f2', sessionId: null },
      { folderId: null, sessionId: 'u1' },
      { folderId: null, sessionId: 'u2' },
    ]);
  });

  it('보고 있는 폴더의 세션만 그 폴더 줄 아래에 낀다', () => {
    expect(buildNavRows(folders, unfiled, 'f1')).toEqual([
      { folderId: 'f1', sessionId: null },
      { folderId: 'f1', sessionId: 'a1' },
      { folderId: 'f1', sessionId: 'a2' },
      { folderId: 'f2', sessionId: null },
      { folderId: null, sessionId: 'u1' },
      { folderId: null, sessionId: 'u2' },
    ]);
  });

  it('폴더 안 마지막 세션에서 아래로 가면 다음 폴더로 넘어간다', () => {
    const rows = buildNavRows(folders, unfiled, 'f1');

    expect(stepNavRow(rows, { folderId: 'f1', sessionId: 'a2' }, 1)).toEqual({
      folderId: 'f2',
      sessionId: null,
    });
  });

  it('마지막 폴더에서 아래로 가면 정리 안 된 세션으로 이어진다', () => {
    const rows = buildNavRows(folders, unfiled, null);

    expect(stepNavRow(rows, { folderId: 'f2', sessionId: null }, 1)).toEqual({
      folderId: null,
      sessionId: 'u1',
    });
  });

  it('미정리 세션끼리 위아래로 움직인다', () => {
    const rows = buildNavRows(folders, unfiled, null);

    expect(stepNavRow(rows, { folderId: null, sessionId: 'u1' }, 1)).toEqual({
      folderId: null,
      sessionId: 'u2',
    });
    expect(stepNavRow(rows, { folderId: null, sessionId: 'u2' }, -1)).toEqual({
      folderId: null,
      sessionId: 'u1',
    });
  });

  it('양 끝에서는 감기지 않고 멈춘다', () => {
    const rows = buildNavRows(folders, unfiled, null);

    expect(stepNavRow(rows, { folderId: 'f1', sessionId: null }, -1)).toBeNull();
    expect(stepNavRow(rows, { folderId: null, sessionId: 'u2' }, 1)).toBeNull();
  });

  it('지금 줄이 목록에 없으면 방향에 맞는 끝에서 시작한다', () => {
    const rows = buildNavRows(folders, unfiled, null);
    const gone = { folderId: 'deleted', sessionId: null };

    expect(stepNavRow(rows, gone, 1)).toEqual(rows[0]);
    expect(stepNavRow(rows, gone, -1)).toEqual(rows[rows.length - 1]);
    expect(stepNavRow(rows, null, 1)).toEqual(rows[0]);
  });

  it('빈 목록에서는 갈 곳이 없다', () => {
    expect(stepNavRow([], null, 1)).toBeNull();
  });
});

describe('궤도 위 점 배치', () => {
  /** 최하단에 놓인 점을 뺀, 지금 그려지는 점들. */
  const rendered = (total: number, offset: number) =>
    Array.from({ length: total }, (_, index) => orbitPlacement(index, offset, total)).filter(
      (placement): placement is NonNullable<typeof placement> => placement !== null,
    );

  it('회전량이 가리키는 점은 언제나 최하단(90도)이다', () => {
    for (const [total, offset] of [[1, 0], [4, 2], [7, 6], [30, 17]] as const) {
      expect(orbitPlacement(offset, offset, total)?.angle).toBe(90);
    }
  });

  it('좌우 이웃은 최하단을 축으로 대칭이다', () => {
    const left = orbitPlacement(4, 5, 30);
    const right = orbitPlacement(6, 5, 30);
    expect(left).not.toBeNull();
    expect(90 - left!.angle).toBeCloseTo(right!.angle - 90, 10);
  });

  it('인덱스가 커질수록 오른쪽으로 간다', () => {
    const angles = [3, 4, 5, 6, 7].map((index) => orbitPlacement(index, 5, 30)!.angle);
    for (let i = 1; i < angles.length; i += 1) {
      expect(angles[i]).toBeGreaterThan(angles[i - 1]);
    }
  });

  it('점이 적으면 전부 온전히 보이고 축소 점이 없다', () => {
    for (const total of [1, 2, 3, 5, ORBIT_VISIBLE_COUNT]) {
      const placements = rendered(total, 0);
      expect(placements).toHaveLength(total);
      expect(placements.every((placement) => placement.beyond === 0)).toBe(true);
    }
  });

  it('점이 많으면 온전한 점은 ORBIT_VISIBLE_COUNT 개고 나머지는 축소 점이다', () => {
    const placements = rendered(30, 10);
    expect(placements.filter((placement) => placement.beyond === 0)).toHaveLength(
      ORBIT_VISIBLE_COUNT,
    );
    // 양 끝에 "더 있다"는 신호가 남는다.
    expect(placements.filter((placement) => placement.beyond > 0).length).toBeGreaterThan(0);
  });

  it('멀리 있는 점은 뒤편이라 그리지 않는다', () => {
    expect(orbitPlacement(20, 0, 40)).toBeNull();
  });

  it('모든 점은 궤도 앞면(0~180도) 안에 놓인다', () => {
    for (const total of [1, 6, 7, 13, 40]) {
      for (const placement of rendered(total, 3)) {
        expect(placement.angle).toBeGreaterThan(0);
        expect(placement.angle).toBeLessThan(180);
      }
    }
  });

  it('빈 궤도는 그릴 자리가 없다', () => {
    expect(orbitPlacement(0, 0, 0)).toBeNull();
  });

  it('링 최단 거리는 절반을 넘지 않는다', () => {
    expect(ringDelta(0, 1, 10)).toBe(1);
    expect(ringDelta(0, 9, 10)).toBe(-1);
    expect(ringDelta(9, 0, 10)).toBe(1);
    expect(ringDelta(2.5, 3, 10)).toBeCloseTo(0.5, 10);
  });

  it('마지막 점에서 첫 점으로 갈 때 한 칸만 돈다', () => {
    // 되감으면 궤도가 거꾸로 아홉 칸을 도는 것처럼 보인다.
    expect(alignOffset(9, 0, 10)).toBe(10);
    expect(alignOffset(0, 9, 10)).toBe(-1);
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

  it('세션 씬은 페이지가 몇 개든 궤도 하나에 담는다', () => {
    // 세션 하나가 궤도 여러 개로 쪼개져 보이면 안 된다 — 앞면에 못 놓는 만큼은
    // 뒤편에 있다가 회전으로 올라온다.
    const events = Array.from({ length: 40 }, (_, index) =>
      event({ eventId: `event-${index}`, sequenceOrder: index, url: `https://x/${index}` }),
    );
    const scene = buildSessionScene(toSessionNode(session(), events, NOW));

    expect(scene.kind).toBe('session');
    expect(scene.tracks).toHaveLength(1);
    expect(scene.tracks[0].points).toHaveLength(40);
    expect(scene.tracks[0].sessionId).toBeNull();
  });

  it('세션 씬의 궤도 라벨은 비어 있다', () => {
    // 중심 노드 아래에 이미 같은 제목이 있어 라벨을 달면 글자가 겹친다.
    const scene = buildSessionScene(toSessionNode(session(), [event()], NOW));

    expect(scene.tracks[0].label).toBe('');
  });

  it('페이지가 없는 세션 씬은 궤도가 없다', () => {
    const scene = buildSessionScene(toSessionNode(session({ tabs: [] }), [], NOW));

    expect(scene.tracks).toEqual([]);
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
