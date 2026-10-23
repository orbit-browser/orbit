// 이벤트 전송은 이벤트 주인의 토큰을 고정해 쓴다. 이전 계정 토큰이 401을 받았다고 지금 로그인한
// 계정이 로그아웃되면 안 되고, 지금 계정의 토큰이 거절된 것이면 평소처럼 세션을 비운다.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { postEventBatch } from '../../lib/api';
import { AuthRequiredError, getSession } from '../../lib/auth';
import { signInTestUser } from '../helpers';

beforeEach(async () => {
  fakeBrowser.reset();
  await signInTestUser(); // 지금 계정: u1, 토큰 test-token
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('이전 계정의 고정 토큰이 401을 받아도 지금 계정의 세션은 남는다', async () => {
  await expect(postEventBatch('device', [], 'previous-account-token')).rejects.toBeInstanceOf(AuthRequiredError);
  expect((await getSession())?.user.id).toBe('u1');
});

it('지금 계정의 토큰이 401을 받으면 세션을 비워 다시 로그인하게 한다', async () => {
  await expect(postEventBatch('device', [], 'test-token')).rejects.toBeInstanceOf(AuthRequiredError);
  expect(await getSession()).toBeNull();
});
