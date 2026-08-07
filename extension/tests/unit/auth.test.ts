import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { clearSession, getSession, getToken } from '../../lib/auth';

const KEY = 'orbit:auth';

function session(overrides: Record<string, unknown> = {}) {
  return {
    token: 'tok-1',
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    user: { id: 'u1', email: 'a@b.com', name: '테스트', picture: null },
    ...overrides,
  };
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe('세션 저장소', () => {
  it('저장된 세션을 그대로 돌려준다', async () => {
    await chrome.storage.local.set({ [KEY]: session() });

    const current = await getSession();

    expect(current?.token).toBe('tok-1');
    expect(current?.user.email).toBe('a@b.com');
  });

  it('세션이 없으면 null', async () => {
    expect(await getSession()).toBeNull();
    expect(await getToken()).toBeNull();
  });

  it('만료된 세션은 null 이고 저장소에서도 지운다', async () => {
    await chrome.storage.local.set({
      [KEY]: session({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
    });

    expect(await getSession()).toBeNull();

    // 만료 토큰을 들고 있으면 401만 반복해서 부른다 — 발견 즉시 버린다.
    const stored = await chrome.storage.local.get(KEY);
    expect(stored[KEY]).toBeUndefined();
  });

  it('토큰이 비어 있는 레코드는 세션으로 보지 않는다', async () => {
    await chrome.storage.local.set({ [KEY]: session({ token: '' }) });
    expect(await getSession()).toBeNull();
  });

  it('clearSession 이 저장소를 비운다', async () => {
    await chrome.storage.local.set({ [KEY]: session() });

    await clearSession();

    expect(await getSession()).toBeNull();
  });

  it('만료 경계 — 아직 남아 있으면 유효', async () => {
    await chrome.storage.local.set({
      [KEY]: session({ expiresAt: new Date(Date.now() + 5_000).toISOString() }),
    });
    expect(await getToken()).toBe('tok-1');
  });
});
