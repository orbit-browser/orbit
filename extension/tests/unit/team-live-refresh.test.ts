import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { focusManager, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fetchWorkspaceSessions } from '../../lib/api';
import { queryClient, trackWindowFocus } from '../../lib/query-client';
import { getSettings, subscribeSettings, updateSettings } from '../../lib/settings';
import { confirmTeamAccess, onTeamAccessLost, teamLabel, workspacesQueryOptions } from '../../lib/useWorkspaces';
import { getAskConversationSnapshot, useAskConversation } from '../../entrypoints/shared/hooks/useAskConversation';
import { toSessionNode } from '../../entrypoints/newtab/components/atlas/data';
import { RecentExploration } from '../../entrypoints/newtab/components/sections/RecentExploration';
import { ExploreCard } from '../../entrypoints/newtab/components/sections/ExploreCard';
import type { Workspace, WorkspaceSession } from '../../lib/types';
import { signInTestUser, signOutTestUser } from '../helpers';

const team: Workspace = {
  id: 'team-a',
  name: '여행 동아리',
  hue: '#fff',
  role: 'member',
  memberCount: 3,
  createdAt: '2026-10-17T00:00:00Z',
};
const backendTeam = {
  workspace_id: 'team-a',
  name: '여행 동아리',
  hue: '#fff',
  role: 'member',
  member_count: 3,
  created_at: '2026-10-17T00:00:00Z',
};

let teamListed = false;
let workspaceListCalls = 0;

function conversation(workspaceId?: string) {
  let result!: ReturnType<typeof useAskConversation>;
  function Probe() {
    result = useAskConversation({ workspaceId });
    return null;
  }
  renderToString(createElement(Probe));
  return result;
}

const nextSettingsChange = () =>
  new Promise<void>((resolve) => {
    const unsubscribe = subscribeSettings(() => {
      unsubscribe();
      resolve();
    });
  });

const teamKeys = () =>
  queryClient.getQueryCache().getAll().map((q) => q.queryKey).filter((key) => key.includes('team-a'));

const failTeamSessions = () =>
  queryClient
    .fetchQuery({ queryKey: ['workspace-sessions', 'team-a'], queryFn: () => fetchWorkspaceSessions('team-a') })
    .catch(() => undefined);

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(async () => {
  await signInTestUser();
  const changed = nextSettingsChange();
  await updateSettings({ activeWorkspaceId: 'team-a', rerankEnabled: false });
  await changed;
  teamListed = false;
  workspaceListCalls = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/assistant/route')) return Response.json({ intent: 'search_memory' });
    if (url.includes('/ask')) {
      return new Response('event: delta\ndata: {"text":"TEAM_ANSWER"}\n\nevent: done\ndata: {"model":"m"}\n\n');
    }
    if (url.endsWith('/workspaces')) {
      workspaceListCalls += 1;
      return Response.json(teamListed ? [backendTeam] : []);
    }
    if (url.endsWith('/workspaces/team-a/sessions')) return new Response('not found', { status: 404 });
    return Response.json([]);
  }));
  queryClient.setQueryData(['workspaces'], [team]);
  queryClient.setQueryData(['newtab', 'atlas-data', 'team-a'], { sessions: ['stale'] });
  queryClient.setQueryData(['workspace-members', 'team-a'], [{ userId: 'u1' }]);
});

afterEach(async () => {
  conversation().startNewConversation();
  queryClient.clear();
  vi.unstubAllGlobals();
  await signOutTestUser();
});

it('returns to my scope, clears Ask and team cache, and tells why when a team API says 404', async () => {
  await conversation('team-a').ask('TEAM_QUESTION');
  expect(getAskConversationSnapshot().turns).toHaveLength(1);
  const notices: string[] = [];
  const stop = onTeamAccessLost((name) => notices.push(name));

  const changed = nextSettingsChange();
  await failTeamSessions();
  await changed;
  await flush();
  stop();

  expect(workspaceListCalls).toBe(1);
  expect((await getSettings()).activeWorkspaceId).toBeNull();
  expect(getAskConversationSnapshot().turns).toEqual([]);
  expect(teamKeys()).toEqual([]);
  expect(notices).toEqual(['여행 동아리']);
});

it('still names the team when a periodic list refresh already dropped it', async () => {
  queryClient.setQueryData(['workspaces'], []);
  const notices: string[] = [];
  const stop = onTeamAccessLost((name) => notices.push(name));

  const changed = nextSettingsChange();
  await confirmTeamAccess(queryClient, 'team-a', '여행 동아리');
  await changed;
  stop();

  expect((await getSettings()).activeWorkspaceId).toBeNull();
  expect(notices).toEqual(['여행 동아리']);
});

it('keeps the team scope when the team list still has it', async () => {
  teamListed = true;
  const notices: string[] = [];
  const stop = onTeamAccessLost((name) => notices.push(name));

  await failTeamSessions();
  await flush();
  stop();

  expect(workspaceListCalls).toBe(1);
  expect((await getSettings()).activeWorkspaceId).toBe('team-a');
  expect(notices).toEqual([]);
});

it('refetches the team list when the window regains focus, even while fresh', async () => {
  const listeners = new EventTarget();
  vi.stubGlobal('window', listeners);
  vi.stubGlobal('document', { visibilityState: 'visible' });
  trackWindowFocus();
  queryClient.mount(); // QueryClientProvider 가 하는 일 — 포커스 알림을 쿼리에 잇는다
  const observer = new QueryObserver(queryClient, workspacesQueryOptions());
  const unsubscribe = observer.subscribe(() => undefined);
  await flush();
  const before = workspaceListCalls;

  listeners.dispatchEvent(new Event('blur'));
  listeners.dispatchEvent(new Event('focus'));
  await flush();

  unsubscribe();
  queryClient.unmount();
  focusManager.setEventListener((onFocus) => {
    onFocus(true);
    return undefined;
  });
  expect(workspaceListCalls).toBe(before + 1);
});

it('polls the team list every 15s only while viewing a team', () => {
  expect(workspacesQueryOptions(true).refetchInterval).toBe(15_000);
  expect(workspacesQueryOptions(false).refetchInterval).toBe(false);
});

const shared: WorkspaceSession = {
  id: 's1',
  title: '제주 여행',
  summary: { overview: '개요', purpose: '', highlights: [], todos: [], nextActions: [] },
  summaryStatus: 'done',
  tabs: [],
  createdAt: '2026-10-17T00:00:00Z',
  updatedAt: '2026-10-17T00:00:00Z',
  sharedBy: { userId: 'u2', name: '민지', picture: null },
  sharedAt: '2026-10-17T00:00:00Z',
} as unknown as WorkspaceSession;

it('shows who shared a team session on home cards', () => {
  const session = toSessionNode(shared, []);
  const recent = renderToString(createElement(RecentExploration, { items: [{ session }], onSelect: () => undefined }));
  const card = renderToString(
    createElement(ExploreCard, { session, badge: '최근 세션', meta: session.date, onOpenDashboard: () => undefined, onRestore: () => undefined }),
  );

  expect(recent).toContain('민지 님이 공유');
  expect(card).toContain('민지 님이 공유');
});

it('팀 이름이 "팀"으로 끝나면 안내에 "팀"을 한 번만 붙인다', () => {
  expect(teamLabel('Orbit 팀')).toBe('Orbit 팀');
  expect(teamLabel('디자인팀')).toBe('디자인팀');
  expect(teamLabel('Orbit')).toBe('Orbit 팀');
  expect(teamLabel(' 연구 ')).toBe('연구 팀');
});
