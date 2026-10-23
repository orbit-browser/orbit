import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearSession, onSessionChange } from '../../lib/auth';
import { queryClient } from '../../lib/query-client';
import { subscribeSettings, updateSettings, type OrbitSettings } from '../../lib/settings';
import { getAskConversationSnapshot, useAskConversation } from '../../entrypoints/shared/hooks/useAskConversation';
import { signInTestUser, signOutTestUser } from '../helpers';

function conversation(workspaceId?: string) {
  let result!: ReturnType<typeof useAskConversation>;
  function Probe() {
    result = useAskConversation({ workspaceId });
    return null;
  }
  renderToString(createElement(Probe));
  return result;
}

async function setAccount(userId: string) {
  const changed = new Promise<void>((resolve) => {
    const unsubscribe = onSessionChange((session) => {
      if (session?.user.id === userId) {
        unsubscribe();
        resolve();
      }
    });
  });
  await chrome.storage.local.set({
    'orbit:auth': {
      token: 'test-token-b', expiresAt: '2099-01-01T00:00:00Z',
      user: { id: userId, email: 'b@example.test', name: 'B', picture: null },
    },
  });
  await changed;
}

const setAccountB = () => setAccount('user-b');

async function logout() {
  const changed = new Promise<void>((resolve) => {
    const unsubscribe = onSessionChange((session) => {
      if (!session) {
        unsubscribe();
        resolve();
      }
    });
  });
  await clearSession();
  await changed;
}

async function changeSettings(partial: Partial<OrbitSettings>) {
  const changed = new Promise<void>((resolve) => {
    const unsubscribe = subscribeSettings(() => {
      unsubscribe();
      resolve();
    });
  });
  await updateSettings(partial);
  await changed;
}

beforeEach(async () => {
  await signInTestUser();
  await changeSettings({ activeWorkspaceId: null, rerankEnabled: false });
  conversation().startNewConversation();
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
    if (String(url).endsWith('/assistant/route')) {
      return Response.json({ intent: 'search_memory' });
    }
    return new Response([
      'event: sources\ndata: {"sessions":[]}\n\n',
      'event: delta\ndata: {"text":"ACCOUNT_A_PRIVATE_ANSWER"}\n\n',
      'event: done\ndata: {"model":"test-model"}\n\n',
    ].join(''));
  }));
});

afterEach(async () => {
  conversation().startNewConversation();
  queryClient.clear();
  vi.unstubAllGlobals();
  await signOutTestUser();
});

it('clears account A Ask turns after logout and account B login', async () => {
  await conversation().ask('ACCOUNT_A_PRIVATE_QUESTION');
  expect(getAskConversationSnapshot().turns[0].answer).toBe('ACCOUNT_A_PRIVATE_ANSWER');
  await clearSession();
  await setAccountB();
  conversation(); // Same JS context: LoginGate can remount without reloading the module.
  expect(getAskConversationSnapshot().turns).toEqual([]);
});

it('does not retain team A Ask answers after selecting team B', async () => {
  await updateSettings({ activeWorkspaceId: 'team-a' });
  await conversation('team-a').ask('TEAM_A_PRIVATE_QUESTION');
  await updateSettings({ activeWorkspaceId: 'team-b' });
  conversation('team-b');
  expect(getAskConversationSnapshot().turns).toEqual([]);
});

it('clears query cache when a different non-null auth session replaces the current account', async () => {
  queryClient.setQueryData(['workspaces'], [{ id: 'account-a-team' }]);
  queryClient.setQueryData(['sessions'], [{ id: 'account-a-private-session' }]);
  await setAccountB();
  expect(queryClient.getQueryData(['sessions'])).toBeUndefined();
  expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
});

it('clears Ask immediately on logout without waiting for another mount or login', async () => {
  await conversation().ask('ACCOUNT_A_PRIVATE_QUESTION');
  await logout();
  expect(getAskConversationSnapshot()).toMatchObject({ turns: [], isStreaming: false });
});

it('clears Ask when account B directly replaces account A', async () => {
  await conversation().ask('ACCOUNT_A_PRIVATE_QUESTION');
  await setAccountB();
  expect(getAskConversationSnapshot().turns).toEqual([]);
});

it('preserves Ask and query data when the same user refreshes their token', async () => {
  await conversation().ask('ACCOUNT_A_PRIVATE_QUESTION');
  queryClient.setQueryData(['sessions'], [{ id: 'account-a-private-session' }]);
  await setAccount('u1');
  expect(getAskConversationSnapshot().turns).toHaveLength(1);
  expect(getAskConversationSnapshot().turns[0].answer).toBe('ACCOUNT_A_PRIVATE_ANSWER');
  expect(queryClient.getQueryData(['sessions'])).toEqual([{ id: 'account-a-private-session' }]);
});

it('preserves a team conversation on remount and unrelated settings changes', async () => {
  await changeSettings({ activeWorkspaceId: 'team-a' });
  await conversation('team-a').ask('TEAM_A_PRIVATE_QUESTION');
  await changeSettings({ rerankEnabled: true });
  conversation('team-a');
  expect(getAskConversationSnapshot().turns).toHaveLength(1);
  expect(getAskConversationSnapshot().turns[0].answer).toBe('ACCOUNT_A_PRIVATE_ANSWER');
});

it.each([
  { name: 'logout', from: 'team-a', to: undefined, change: logout },
  { name: 'account replacement', from: 'team-a', to: 'team-a', change: setAccountB },
  { name: 'personal to team', from: undefined, to: 'team-a', change: () => changeSettings({ activeWorkspaceId: 'team-a' }) },
  { name: 'team to team', from: 'team-a', to: 'team-b', change: () => changeSettings({ activeWorkspaceId: 'team-b' }) },
  { name: 'team to personal', from: 'team-a', to: undefined, change: () => changeSettings({ activeWorkspaceId: null }) },
])('aborts streaming on $name and ignores late events while a new request is running', async ({ name, from, to, change }) => {
  await changeSettings({ activeWorkspaceId: from ?? null });
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const signals: AbortSignal[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (String(url).endsWith('/assistant/route')) return Response.json({ intent: 'search_memory' });
    signals.push(init!.signal as AbortSignal);
    // Deliberately ignore abort to exercise buffered or late transport events.
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) { streams.push(controller); },
    }));
  }));

  const oldRequest = conversation(from).ask('OLD_PRIVATE_QUESTION');
  await vi.waitFor(() => expect(streams).toHaveLength(1));
  await change();
  expect(signals[0].aborted).toBe(true);
  expect(getAskConversationSnapshot()).toMatchObject({ turns: [], isStreaming: false });
  if (name === 'logout') await setAccountB();

  const newRequest = conversation(to).ask('NEW_QUESTION');
  await vi.waitFor(() => expect(streams).toHaveLength(2));
  streams[0].enqueue(new TextEncoder().encode(
    'event: delta\ndata: {"text":"OLD_PRIVATE_ANSWER"}\n\nevent: done\ndata: {"model":"old"}\n\n',
  ));
  streams[0].close();
  await oldRequest;
  expect(getAskConversationSnapshot().isStreaming).toBe(true);
  expect(getAskConversationSnapshot().turns).toHaveLength(1);
  expect(getAskConversationSnapshot().turns[0]).toMatchObject({ query: 'NEW_QUESTION', answer: '', status: 'streaming' });

  streams[1].enqueue(new TextEncoder().encode(
    'event: delta\ndata: {"text":"NEW_ANSWER"}\n\nevent: done\ndata: {"model":"new"}\n\n',
  ));
  streams[1].close();
  await newRequest;
  expect(getAskConversationSnapshot().isStreaming).toBe(false);
  expect(getAskConversationSnapshot().turns[0]).toMatchObject({ answer: 'NEW_ANSWER', status: 'done', model: 'new' });
});

it('does not send an old question after a late route response crosses an account change', async () => {
  let finishRoute!: (response: Response) => void;
  const fetch = vi.fn((url: string | URL) => {
    if (String(url).endsWith('/assistant/route')) {
      return new Promise<Response>((resolve) => { finishRoute = resolve; });
    }
    return Promise.resolve(new Response('event: done\ndata: {"model":"old"}\n\n'));
  });
  vi.stubGlobal('fetch', fetch);
  const pending = conversation().ask('ACCOUNT_A_PRIVATE_QUESTION');
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  await setAccountB();
  finishRoute(Response.json({ intent: 'search_memory' }));
  await pending;
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(getAskConversationSnapshot()).toMatchObject({ turns: [], isStreaming: false });
});

it('cancels pending queries on direct account replacement and ignores their late responses', async () => {
  let resolve!: (value: string[]) => void;
  const pending = queryClient.fetchQuery({
    queryKey: ['workspace-sessions', 'old-team'],
    queryFn: () => new Promise<string[]>((done) => { resolve = done; }),
  }).catch(() => undefined);
  await setAccountB();
  resolve(['old-account-private-record']);
  await pending;
  expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
});
