import { afterEach, beforeEach, expect, it } from 'vitest';
import { clearSession, onSessionChange } from '../../lib/auth';
import { queryClient } from '../../lib/query-client';
import { signInTestUser, signOutTestUser } from '../helpers';

beforeEach(signInTestUser);
afterEach(async () => {
  queryClient.clear();
  await signOutTestUser();
});

it('logout cancels a pending query and a late response cannot repopulate the cache', async () => {
  let resolve!: (value: string[]) => void;
  const pending = queryClient.fetchQuery({
    queryKey: ['workspace-sessions', 'old-team'],
    queryFn: () => new Promise<string[]>((done) => { resolve = done; }),
  }).catch(() => undefined);
  const loggedOut = new Promise<void>((done) => {
    const unsubscribe = onSessionChange((session) => {
      if (!session) {
        unsubscribe();
        done();
      }
    });
  });
  await clearSession();
  await loggedOut;
  resolve(['old-account-private-record']);
  await pending;
  expect(queryClient.getQueryData(['workspace-sessions', 'old-team'])).toBeUndefined();
  expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
});
