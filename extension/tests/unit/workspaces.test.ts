import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchSessions,
  fetchWorkspaceSessions,
  joinWorkspace,
  shareSessions,
} from '../../lib/api';
import { sharedMergeNotice } from '../../lib/merge';
import { queryClient } from '../../lib/query-client';
import { resolveWorkspaceScope } from '../../lib/useWorkspaces';
import type { Workspace } from '../../lib/types';
import { toSessionNode } from '../../entrypoints/newtab/components/atlas/data';
import { signInTestUser, signOutTestUser } from '../helpers';

beforeEach(async () => {
  await signInTestUser();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await signOutTestUser();
});

const backendSession = {
  session_id: 's1',
  title: '벡터 DB 비교',
  alias: null,
  summary: { overview: '개요', purpose: '', highlights: [], todos: [], next_actions: [] },
  summary_status: 'done',
  tabs: [],
  created_at: '2026-10-17T00:00:00Z',
  updated_at: '2026-10-17T00:00:00Z',
  last_activity_at: null,
  folder_id: 'owner-private-folder',
};

function stubJson(body: unknown, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify(body), { status });
    }),
  );
  return calls;
}

const team = (id: string): Workspace => ({
  id,
  name: id,
  hue: '#fff',
  role: 'member',
  memberCount: 2,
  createdAt: '2026-10-17T00:00:00Z',
});

describe('workspace scope', () => {
  it('목록을 받기 전에는 저장된 팀을 그대로 쓴다', () => {
    expect(resolveWorkspaceScope('ws-1', undefined)).toEqual({
      active: null,
      scopeId: 'ws-1',
      stale: false,
    });
  });

  it('목록에 있는 팀이면 그 팀을 범위로 쓴다', () => {
    const result = resolveWorkspaceScope('ws-1', [team('ws-1')]);
    expect(result.scopeId).toBe('ws-1');
    expect(result.stale).toBe(false);
  });

  it('나간 팀을 가리키면 개인으로 돌리라고 알린다', () => {
    expect(resolveWorkspaceScope('gone', [team('ws-1')])).toEqual({
      active: null,
      scopeId: null,
      stale: true,
    });
  });

  it('개인 범위는 stale 이 아니다', () => {
    expect(resolveWorkspaceScope(null, [])).toEqual({ active: null, scopeId: null, stale: false });
  });
});

describe('workspace api', () => {
  it('내 세션 목록에 공유 중인 팀을 싣는다', async () => {
    stubJson([{ ...backendSession, shared_workspace_ids: ['ws-1'] }]);
    const [session] = await fetchSessions();
    expect(session.sharedWorkspaceIds).toEqual(['ws-1']);
  });

  it('이전 서버 응답에 공유 필드가 없어도 빈 목록으로 읽는다', async () => {
    stubJson([backendSession]);
    const [session] = await fetchSessions();
    expect(session.sharedWorkspaceIds).toEqual([]);
  });

  it('팀 세션은 공유한 사람을 싣고 남의 개인 폴더는 버린다', async () => {
    stubJson([
      {
        ...backendSession,
        shared_by: { user_id: 'u2', name: '민수', picture: null },
        shared_at: '2026-10-17T01:00:00Z',
      },
    ]);
    const [session] = await fetchWorkspaceSessions('ws-1');
    expect(session.sharedBy).toEqual({ userId: 'u2', name: '민수', picture: null });
    expect(session.folderId).toBeUndefined();
  });

  it('공유 요청은 snake_case 계약으로 보낸다', async () => {
    const calls = stubJson({ workspace_id: 'ws-1', shared: ['s1'], skipped: ['x'] });
    const result = await shareSessions('ws-1', ['s1', 'x']);
    expect(calls[0].url).toMatch(/\/workspaces\/ws-1\/sessions$/);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ session_ids: ['s1', 'x'] });
    expect(result).toEqual({ workspaceId: 'ws-1', shared: ['s1'], skipped: ['x'] });
  });

  it('무효한 초대 코드는 오류로 알린다', async () => {
    stubJson({ detail: '유효하지 않거나 만료된 초대 코드입니다' }, 400);
    await expect(joinWorkspace('nope')).rejects.toThrow(/400/);
  });
});

describe('merge notice for shared sessions', () => {
  const pair = { survivorId: 'a', absorbedId: 'b' };

  it('공유된 세션이 없으면 안내하지 않는다', () => {
    expect(sharedMergeNotice(pair, new Set())).toBe('');
  });

  it('흡수되는 쪽이 공유 중이면 팀에서 사라진다고 알린다', () => {
    expect(sharedMergeNotice(pair, new Set(['b']))).toContain('팀 화면에서 사라져요');
  });

  it('합쳐질 쪽이 공유 중이면 흡수되는 페이지가 팀에 보인다고 알린다', () => {
    expect(sharedMergeNotice(pair, new Set(['a']))).toContain('페이지도 팀에 보이게');
  });
});

describe('atlas sharers', () => {
  const base = {
    id: 's',
    title: 't',
    alias: null,
    tabs: [],
    createdAt: '2026-10-17T00:00:00Z',
    updatedAt: '2026-10-17T00:00:00Z',
    timeLabel: '',
    summary: { overview: '', highlights: [] },
    summaryStatus: 'done' as const,
    sharedAt: '2026-10-17T00:00:00Z',
  };
  it('개인 세션에는 공유한 사람이 없다', () => {
    const { sharedAt: _sharedAt, ...personal } = base;
    expect(toSessionNode(personal, []).sharedBy).toBeUndefined();
  });
});

describe('account switch', () => {
  it('로그아웃하면 이전 계정의 팀·세션 캐시를 비운다', async () => {
    queryClient.setQueryData(['workspaces'], [team('ws-1')]);
    queryClient.setQueryData(['workspace-sessions', 'ws-1'], []);

    await signOutTestUser();
    // 저장소 변경 알림은 비동기로 온다.
    await vi.waitFor(() => expect(queryClient.getQueryData(['workspaces'])).toBeUndefined());
    expect(queryClient.getQueryData(['workspace-sessions', 'ws-1'])).toBeUndefined();
  });
});
