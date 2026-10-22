import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';

const askOptions: unknown[] = [];

vi.mock('../../entrypoints/shared/hooks/useAskConversation', () => ({
  useAskConversation: (options?: unknown) => {
    askOptions.push(options);
    return {
      turns: [],
      ask: async () => undefined,
      cancel: () => undefined,
      startNewConversation: () => undefined,
      isStreaming: false,
      selectTabCandidate: async () => undefined,
    };
  },
}));

vi.mock('../../lib/useWorkspaces', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/useWorkspaces')>()),
  useActiveWorkspace: () => ({ workspaces: [], active: null, scopeId: 'team-a', select: () => undefined }),
}));

it('asks the home Ask in the workspace the home screen is showing', async () => {
  const { default: App } = await import('../../entrypoints/newtab/App');
  renderToString(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(App)));
  expect(askOptions.at(-1)).toEqual({ workspaceId: 'team-a' });
});
