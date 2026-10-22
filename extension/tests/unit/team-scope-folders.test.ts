import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AtlasData } from '../../entrypoints/newtab/hooks/useAtlasData';
import type { SessionNode } from '../../entrypoints/newtab/components/atlas/data';

const fetchFolderSuggestions = vi.fn(async () => []);
const queryOptions: { queryKey: readonly unknown[]; enabled?: unknown }[] = [];

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: ((options: { queryKey: readonly unknown[]; enabled?: unknown }) => {
      queryOptions.push(options);
      return actual.useQuery(options as never);
    }) as typeof actual.useQuery,
  };
});
const drawerProps: Record<string, unknown>[] = [];
let scopeId: string | null = 'team-a';

vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  fetchFolderSuggestions,
}));

vi.mock('../../lib/useWorkspaces', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/useWorkspaces')>()),
  useActiveWorkspace: () => ({ workspaces: [], active: null, scopeId, select: () => undefined }),
}));

vi.mock('../../entrypoints/newtab/components/layout/NavigatorDrawer', () => ({
  NavigatorDrawer: (props: Record<string, unknown>) => {
    drawerProps.push(props);
    return null;
  },
}));

const session = (id: string): SessionNode => ({
  id, title: id, alias: null, date: '', minutes: 1, status: 'recent', category: '', icon: '', hue: '',
  summary: { overview: '', highlights: [], nextActions: [] }, pages: [],
});

const atlas: AtlasData = {
  sessions: [session('s1')],
  folders: [{ id: 'f1', name: '여행', hue: '#000', position: 0, sessions: [] }],
  unfiled: [session('s1')],
};

beforeEach(() => {
  fetchFolderSuggestions.mockClear();
  drawerProps.length = 0;
  queryOptions.length = 0;
});

async function suggestionsFor(enabled: boolean) {
  const { useFolderSuggestions } = await import('../../entrypoints/newtab/hooks/useAtlasData');
  const client = new QueryClient();
  // 이미 받아 둔 제안이 캐시에 있어도 팀 범위(enabled=false)에서는 그리지 않는다.
  client.setQueryData(['newtab', 'folder-suggestions', 1], [
    { sessionId: 's1', folderId: 'f1', score: 0.5, similarSessionIds: [] },
  ]);
  let result: unknown;
  function Probe() {
    result = useFolderSuggestions(atlas, 1, enabled);
    return null;
  }
  renderToString(createElement(QueryClientProvider, { client }, createElement(Probe)));
  return { result, client };
}

it('team scope (enabled=false) yields no folder suggestions and requests none', async () => {
  const team = await suggestionsFor(false);
  const personal = await suggestionsFor(true);

  expect(team.result).toEqual([]);
  expect((personal.result as unknown[]).length).toBe(1);
  // 요청 여부는 react-query의 enabled가 정한다 — 팀 범위 쿼리는 꺼진 채로 등록돼야 한다.
  const suggestionQueries = queryOptions.filter((options) => options.queryKey[1] === 'folder-suggestions');
  expect(suggestionQueries.map((options) => options.enabled)).toEqual([false, true]);
  expect(fetchFolderSuggestions).not.toHaveBeenCalled();
});

it('home drawer is read-only with no suggestions in team scope, editable in personal scope', async () => {
  const { default: App } = await import('../../entrypoints/newtab/App');
  const render = () =>
    renderToString(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(App)));

  scopeId = 'team-a';
  render();
  expect(drawerProps.at(-1)).toMatchObject({ readOnly: true, suggestions: [] });

  scopeId = null;
  render();
  expect(drawerProps.at(-1)).toMatchObject({ readOnly: false });
});
