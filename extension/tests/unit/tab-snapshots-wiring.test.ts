// 배선 시험: 검사 대상(아틀라스 화면·사이드패널 세션 상세)은 실제로 그리고, 한 단계 아래 자식
// (AtlasCanvas·TabListItem)만 대역으로 바꿔 사진이 넘어가는지 본다. 팀 범위에서 남의 세션에는 넘기지 않는다.
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AtlasData } from '../../entrypoints/newtab/hooks/useAtlasData';
import type { SessionNode } from '../../entrypoints/newtab/components/atlas/data';
import type { MemberBrief, Session, WorkspaceSession } from '../../lib/types';

const PAGE = 'https://example.com/guide';
const SHOT = 'data:image/jpeg;base64,SHOT';
const ME: MemberBrief = { userId: 'me', name: '나', picture: null };
const OTHER: MemberBrief = { userId: 'u2', name: '민지', picture: null };

let scopeId: string | null = null;
const canvasProps: Record<string, unknown>[] = [];
const tabItemProps: Record<string, unknown>[] = [];

vi.mock('../../lib/useWorkspaces', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/useWorkspaces')>()),
  useActiveWorkspace: () => ({ workspaces: [], active: null, scopeId, select: () => undefined }),
}));

vi.mock('../../lib/useAuth', () => ({
  useAuth: () => ({
    session: { token: 't', expiresAt: '', user: { id: 'me', email: '', name: '', picture: null } },
    loading: false,
    signingIn: false,
    error: null,
    signIn: async () => undefined,
    signOut: async () => undefined,
  }),
}));

vi.mock('../../entrypoints/newtab/components/atlas/AtlasCanvas', () => ({
  AtlasCanvas: (props: Record<string, unknown>) => {
    canvasProps.push(props);
    return null;
  },
}));

vi.mock('../../entrypoints/sidepanel/components/TabListItem', () => ({
  TabListItem: (props: Record<string, unknown>) => {
    tabItemProps.push(props);
    return null;
  },
}));

const node = (sharedBy?: MemberBrief): SessionNode => ({
  id: 's1', title: '가이드', alias: null, date: '', minutes: 1, status: 'recent', category: '', icon: '', hue: '',
  summary: { overview: '', highlights: [], nextActions: [] },
  pages: [{ id: 'p1', title: '가이드', url: PAGE, domain: 'example.com', minutes: 1, visits: 1 }],
  sharedBy,
});

function clientWith(seed: (client: QueryClient) => void) {
  const client = new QueryClient();
  client.setQueryData(['tab-snapshots', [PAGE]], { [PAGE]: SHOT });
  seed(client);
  return client;
}

beforeEach(() => {
  canvasProps.length = 0;
  tabItemProps.length = 0;
  // 아틀라스는 첫 렌더에 주소의 해시를 읽는다. node 환경에는 window 가 없다.
  vi.stubGlobal('window', { location: { hash: '' } });
});

afterEach(() => vi.unstubAllGlobals());

async function atlasShots(scope: string | null, sharedBy?: MemberBrief) {
  const { VariantAtlasReplica } = await import('../../entrypoints/newtab/components/VariantAtlasReplica');
  scopeId = scope;
  const data: AtlasData = { sessions: [node(sharedBy)], folders: [], unfiled: [node(sharedBy)] };
  const client = clientWith((c) => c.setQueryData(['newtab', 'atlas-data', scope], data));
  renderToString(createElement(QueryClientProvider, { client }, createElement(VariantAtlasReplica)));
  return canvasProps.at(-1)?.shots;
}

it('새 탭 아틀라스: 개인 세션과 내가 공유한 팀 세션에는 사진을 넘기고, 남의 팀 세션에는 넘기지 않는다', async () => {
  expect(await atlasShots(null)).toEqual({ [PAGE]: SHOT });
  expect(await atlasShots('team-a', ME)).toEqual({ [PAGE]: SHOT });
  expect(await atlasShots('team-a', OTHER)).toEqual({});
});

async function detailShots(scope: string | null, sharedBy?: MemberBrief) {
  const { useUIStore } = await import('../../entrypoints/sidepanel/store/ui');
  const { SessionDetailView } = await import('../../entrypoints/sidepanel/views/SessionDetailView');
  // zustand 는 서버 렌더에서 처음 상태 객체(getInitialState)를 읽는다. 그 객체에 고른 세션을 둔다.
  Object.assign(useUIStore.getInitialState(), { selectedSessionId: 's1' });
  scopeId = scope;
  const session = {
    id: 's1', title: '가이드', alias: null, tabs: [{ id: '1', title: '가이드', url: PAGE }],
    createdAt: '', updatedAt: '', timeLabel: '', summary: { overview: '', highlights: [] }, summaryStatus: 'done',
  } as Session;
  const client = clientWith((c) => {
    c.setQueryData(['session', 's1'], session);
    if (scope && sharedBy) c.setQueryData(['workspace-sessions', scope], [{ ...session, sharedBy } as WorkspaceSession]);
  });
  renderToString(createElement(QueryClientProvider, { client }, createElement(SessionDetailView)));
  return tabItemProps.at(-1)?.shot;
}

it('사이드패널 세션 상세: 탭 목록에 사진을 넘기되, 팀 범위에서는 내가 공유한 세션에만', async () => {
  expect(await detailShots(null)).toBe(SHOT);
  expect(await detailShots('team-a', ME)).toBe(SHOT);
  expect(await detailShots('team-a', OTHER)).toBeUndefined();
  // 팀 목록을 아직 못 받아 공유자를 모를 때도 붙이지 않는다.
  expect(await detailShots('team-a')).toBeUndefined();
});

it('갤러리 카드는 받은 사진을 그리고(조각 # 무시), 없으면 회색 칸 그대로다', async () => {
  const { AtlasGallery } = await import('../../entrypoints/newtab/components/atlas/AtlasGallery');
  const point = (id: string, url: string) => ({ id, url, title: id }) as never;
  const html = renderToString(
    createElement(AtlasGallery, {
      points: [point('a', `${PAGE}#top`), point('b', 'https://example.com/none')],
      selectedPointId: 'a',
      onSelectPoint: () => undefined,
      shots: { [PAGE]: SHOT },
    }),
  );
  expect(html.match(/<img /g)).toHaveLength(1);
  expect(html).toContain(`src="${SHOT}"`);
});
