// 앞에 띄워 둔 새 탭(보이지만 포커스는 없음)도 공유 해제를 10초 안에 비춘다(지시 7d).
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  onTeamSessionsUnshared,
  reconcileTeamShares,
  teamShareQueryOptions,
  type AtlasData,
} from '../../entrypoints/newtab/hooks/useAtlasData';
import type { SessionNode } from '../../entrypoints/newtab/components/atlas/data';
import { signInTestUser, signOutTestUser } from '../helpers';

const KEY = ['newtab', 'atlas-data', 'team-a'];
const node = (id: string) => ({ id }) as SessionNode;
const atlas = (...ids: string[]): AtlasData => ({
  sessions: ids.map(node),
  folders: [],
  unfiled: ids.map(node),
});

const backendSession = (id: string) => ({
  session_id: id,
  title: id,
  tabs: [],
  created_at: '2026-10-23T00:00:00Z',
  updated_at: '2026-10-23T00:00:00Z',
  summary: { overview: '', purpose: '', highlights: [], todos: [], next_actions: [] },
  summary_status: 'done',
  shared_by: { user_id: 'u2', name: '민지', picture: null },
  shared_at: '2026-10-23T00:00:00Z',
});

let liveIds: string[] = [];
let sessionCalls = 0;

beforeEach(async () => {
  await signInTestUser();
  liveIds = ['s1', 's2'];
  sessionCalls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/workspaces/team-a/sessions')) {
        sessionCalls += 1;
        return Response.json(liveIds.map(backendSession));
      }
      return Response.json([]);
    }),
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await signOutTestUser();
});

it('공유가 풀린 세션은 아틀라스를 다시 받기 전에 바로 빼고 안내한다', () => {
  const client = new QueryClient();
  client.setQueryData(KEY, atlas('s1', 's2'));
  const notices: number[] = [];
  const stop = onTeamSessionsUnshared((count) => notices.push(count));

  reconcileTeamShares(client, 'team-a', ['s1']);
  stop();

  const data = client.getQueryData<AtlasData>(KEY)!;
  expect(data.sessions.map((s) => s.id)).toEqual(['s1']);
  expect(data.unfiled.map((s) => s.id)).toEqual(['s1']);
  expect(notices).toEqual([1]);
});

it('목록이 같으면 아무것도 바꾸지 않고, 새로 공유된 세션이 있으면 아틀라스를 다시 받는다', () => {
  const client = new QueryClient();
  client.setQueryData(KEY, atlas('s1'));
  const notices: number[] = [];
  const stop = onTeamSessionsUnshared((count) => notices.push(count));

  reconcileTeamShares(client, 'team-a', ['s1']);
  expect(client.getQueryState(KEY)?.isInvalidated).toBe(false);
  reconcileTeamShares(client, 'team-a', ['s1', 's3']);
  stop();

  expect(client.getQueryState(KEY)?.isInvalidated).toBe(true);
  expect(notices).toEqual([]);
});

// react-query 는 모듈을 읽을 때 window 가 없으면 서버로 보고 주기 갱신 타이머를 아예 만들지 않는다(node 시험 환경).
// 그래서 주기 자체는 옵션으로 확인하고, 실제 갱신은 미리보기·격리 E2E 에서 본다.
it('창 포커스가 없어도 화면에 보이면 8초마다 공유 목록을 확인한다', () => {
  vi.stubGlobal('document', { visibilityState: 'visible' });
  const options = teamShareQueryOptions('team-a');
  // 포커스를 잃은 창(background)에서도 주기를 멈추지 않는다.
  expect(options.refetchIntervalInBackground).toBe(true);
  expect(options.refetchInterval()).toBe(8_000);
  expect(options.refetchOnWindowFocus).toBe('always');
});

it('숨은 새 탭은 확인하지 않는다', () => {
  vi.stubGlobal('document', { visibilityState: 'hidden' });
  expect(teamShareQueryOptions('team-a').refetchInterval()).toBe(false);
});

it('공유 목록 질의는 그 팀의 세션 id 만 돌려준다', async () => {
  const client = new QueryClient();
  liveIds = ['s1', 's3'];
  expect(await client.fetchQuery(teamShareQueryOptions('team-a'))).toEqual(['s1', 's3']);
  expect(sessionCalls).toBe(1);
});
