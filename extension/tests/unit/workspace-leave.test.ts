import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { queryClient } from '../../lib/query-client';
import { getSettings, subscribeSettings, updateSettings } from '../../lib/settings';
import { getAskConversationSnapshot, useAskConversation } from '../../entrypoints/shared/hooks/useAskConversation';
import { useWorkspaceMutations } from '../../entrypoints/sidepanel/hooks/useWorkspaces';
import { signInTestUser, signOutTestUser } from '../helpers';

// 화면(설정 페이지·사이드패널)이 결과를 받기 전에 사라져도 범위와 캐시는 공용 훅이 정리해야 한다.
// 그래서 mutate 단위 콜백 없이 훅의 mutateAsync 만 부른다.
function mutations() {
  let result!: ReturnType<typeof useWorkspaceMutations>;
  function Probe() {
    result = useWorkspaceMutations();
    return null;
  }
  renderToString(createElement(QueryClientProvider, { client: queryClient }, createElement(Probe)));
  return result;
}

function conversation(workspaceId?: string) {
  let result!: ReturnType<typeof useAskConversation>;
  function Probe() {
    result = useAskConversation({ workspaceId });
    return null;
  }
  renderToString(createElement(Probe));
  return result;
}

async function settled(action: () => Promise<unknown>) {
  const changed = new Promise<void>((resolve) => {
    const unsubscribe = subscribeSettings(() => {
      unsubscribe();
      resolve();
    });
  });
  await action();
  await changed;
}

const backendTeam = {
  workspace_id: 'team-a',
  name: '여행 동아리',
  hue: '#fff',
  role: 'member',
  member_count: 3,
  created_at: '2026-10-17T00:00:00Z',
};

beforeEach(async () => {
  await signInTestUser();
  await settled(() => updateSettings({ activeWorkspaceId: 'team-a', rerankEnabled: false }));
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/assistant/route')) return Response.json({ intent: 'search_memory' });
    if (url.includes('/ask')) {
      return new Response('event: delta\ndata: {"text":"TEAM_ANSWER"}\n\nevent: done\ndata: {"model":"m"}\n\n');
    }
    if (url.endsWith('/workspaces/join')) return Response.json(backendTeam);
    if (url.endsWith('/workspaces')) return Response.json([]);
    if (init?.method === 'DELETE') return new Response(null, { status: 204 });
    return Response.json([]);
  }));
  queryClient.setQueryData(['newtab', 'atlas-data', 'team-a'], { sessions: ['stale'] });
  queryClient.setQueryData(['workspace-members', 'team-a'], [{ userId: 'u1' }]);
  queryClient.setQueryData(['workspace-sessions', 'team-a'], [{ id: 'stale' }]);
  queryClient.setQueryData(['newtab', 'atlas-data', 'team-b'], { sessions: ['keep'] });
});

afterEach(async () => {
  conversation().startNewConversation();
  queryClient.clear();
  vi.unstubAllGlobals();
  await signOutTestUser();
});

const teamKeys = () =>
  queryClient.getQueryCache().getAll().map((q) => q.queryKey).filter((key) => key.includes('team-a'));

it.each([
  { name: 'leaving', run: () => mutations().removeMember.mutateAsync({ workspaceId: 'team-a', userId: 'u1' }) },
  { name: 'deleting', run: () => mutations().remove.mutateAsync('team-a') },
])('clears the stored scope, Ask and team cache after $name the current team', async ({ run }) => {
  await conversation('team-a').ask('TEAM_QUESTION');
  expect(getAskConversationSnapshot().turns).toHaveLength(1);

  await run();

  expect((await getSettings()).activeWorkspaceId).toBeNull();
  expect(getAskConversationSnapshot().turns).toEqual([]);
  expect(teamKeys()).toEqual([]);
  expect(queryClient.getQueryData(['newtab', 'atlas-data', 'team-b'])).toEqual({ sessions: ['keep'] });
});

it('keeps my scope and team cache when an owner removes someone else', async () => {
  await mutations().removeMember.mutateAsync({ workspaceId: 'team-a', userId: 'u2' });

  expect((await getSettings()).activeWorkspaceId).toBe('team-a');
  expect(queryClient.getQueryData(['newtab', 'atlas-data', 'team-a'])).toEqual({ sessions: ['stale'] });
});

it('keeps the stored scope when leaving a team I am not viewing', async () => {
  await settled(() => updateSettings({ activeWorkspaceId: 'team-b' }));
  await mutations().removeMember.mutateAsync({ workspaceId: 'team-a', userId: 'u1' });

  expect((await getSettings()).activeWorkspaceId).toBe('team-b');
  expect(teamKeys()).toEqual([]);
});

it('drops cached data of a team I join again so old shares are not shown', async () => {
  await settled(() => updateSettings({ activeWorkspaceId: null }));
  await mutations().join.mutateAsync('INVITE-CODE');

  expect(teamKeys()).toEqual([]);
});
