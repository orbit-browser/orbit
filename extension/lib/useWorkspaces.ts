import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { fetchWorkspaces } from './api';
import { getSettings, subscribeSettings, updateSettings } from './settings';
import type { Workspace } from './types';

export const WORKSPACES_QUERY_KEY = ['workspaces'] as const;

/**
 * 팀 목록은 가볍고, 내보내졌는지 알 수 있는 유일한 곳이다. 그래서 창으로 돌아오면 신선해도
 * 다시 받고, 팀을 보는 동안에는 사이드패널 팀 세션과 같은 15초 주기로 확인한다.
 */
export function workspacesQueryOptions(pollTeams = false) {
  return {
    queryKey: WORKSPACES_QUERY_KEY,
    queryFn: fetchWorkspaces,
    refetchOnWindowFocus: 'always' as const,
    refetchInterval: pollTeams ? 15_000 : (false as const),
  };
}

export function useWorkspaces(pollTeams = false) {
  return useQuery(workspacesQueryOptions(pollTeams));
}

/**
 * 나가거나 지워졌거나 내보내진 팀이 지금 범위면 개인으로 돌리고 그 팀의 캐시(아틀라스·멤버·팀 세션)를
 * 버린다. 저장값을 바꾸면 설정 구독이 Ask 대화를 비운다. 다시 참여했을 때 옛 공유 상태가 보이면 안 된다.
 */
export async function forgetTeam(client: QueryClient, workspaceId: string) {
  const settings = await getSettings();
  if (settings.activeWorkspaceId === workspaceId) await updateSettings({ activeWorkspaceId: null });
  client.removeQueries({ predicate: (query) => query.queryKey.includes(workspaceId) });
}

/** 안내 문구용 팀 이름. 이름이 이미 "팀"으로 끝나면 "Orbit 팀 팀에"처럼 겹치지 않게 그대로 둔다. */
export function teamLabel(name: string): string {
  const trimmed = name.trim();
  return trimmed.endsWith('팀') ? trimmed : `${trimmed} 팀`;
}

const accessLostListeners = new Set<(teamName: string) => void>();

/** 보던 팀에 접근할 수 없게 돼 개인 범위로 돌아왔을 때 화면이 안내를 띄우도록 알린다. */
export function onTeamAccessLost(listener: (teamName: string) => void) {
  accessLostListeners.add(listener);
  return () => {
    accessLostListeners.delete(listener);
  };
}

/**
 * 팀 요청이 403/404 를 받았거나 목록에서 팀이 사라졌을 때 부른다. 목록을 새로 받아 정말 없을 때만
 * 정리한다 — 다른 화면에서 방금 참여한 팀이면 이 화면의 목록만 낡았을 수 있다.
 * 안내는 이름을 아는 팀일 때만 띄운다(다른 계정의 저장값은 조용히 정리한다). 주기 갱신으로 목록이
 * 이미 바뀌었으면 캐시에 이름이 없으므로, 화면이 기억한 이름을 `teamName` 으로 넘긴다.
 */
export function confirmTeamAccess(client: QueryClient, workspaceId: string, teamName?: string): Promise<void> {
  // 같은 팀 확인이 여러 화면·요청에서 한꺼번에 오면 하나로 합친다(안내가 겹쳐 뜨지 않게).
  let pending = confirming.get(workspaceId);
  if (!pending) {
    pending = checkTeamAccess(client, workspaceId, teamName).finally(() => confirming.delete(workspaceId));
    confirming.set(workspaceId, pending);
  }
  return pending;
}

const confirming = new Map<string, Promise<void>>();

async function checkTeamAccess(client: QueryClient, workspaceId: string, teamName?: string) {
  const known =
    teamName ?? client.getQueryData<Workspace[]>(WORKSPACES_QUERY_KEY)?.find((w) => w.id === workspaceId)?.name;
  let teams: Workspace[];
  try {
    teams = await client.fetchQuery({ queryKey: WORKSPACES_QUERY_KEY, queryFn: fetchWorkspaces, staleTime: 0 });
  } catch {
    return; // 목록도 못 받으면 접근 상실인지 알 수 없다. 범위를 그대로 두고 다음 갱신에 다시 본다.
  }
  if (teams.some((w) => w.id === workspaceId)) return;
  const wasActive = (await getSettings()).activeWorkspaceId === workspaceId;
  await forgetTeam(client, workspaceId);
  if (wasActive && known) accessLostListeners.forEach((listener) => listener(known));
}

/**
 * 저장된 선택과 팀 목록으로 지금 범위를 정한다. workspaces 가 undefined 면 아직 목록을 받기 전이다.
 *
 * 목록을 받기 전에는 저장된 값을 믿는다(새로 열 때 개인 화면이 깜빡이지 않게). 받은 뒤에는
 * 목록에 있는 팀만 쓰고, 없는 팀을 가리키면 개인 화면을 그리며 `stale` 로 알린다.
 */
export function resolveWorkspaceScope(storedId: string | null, workspaces: Workspace[] | undefined) {
  if (workspaces === undefined) return { active: null, scopeId: storedId, stale: false };
  const active = workspaces.find((w) => w.id === storedId) ?? null;
  return { active, scopeId: active?.id ?? null, stale: storedId !== null && active === null };
}

/**
 * 지금 보고 있는 범위(개인 또는 팀). 사이드패널과 새 탭이 함께 쓴다.
 *
 * 선택은 chrome.storage 에 있어 한쪽에서 바꾸면 다른 쪽도 따라간다. 목록에 없는 팀(탈퇴했거나
 * 내보내졌거나 다른 계정으로 로그인했거나 팀이 지워짐)을 가리키면 바로 개인 화면을 그린다 — 그대로
 * 두면 모든 팀 요청이 404 로 비어 보인다. 저장값은 목록을 새로 받아 본 뒤에야 지운다
 * (`confirmTeamAccess`).
 *
 * `pollTeams` 는 화면의 뿌리 한 곳에서만 켠다. 관찰자마다 따로 주기 요청을 돌리기 때문이다.
 */
export function useActiveWorkspace({ pollTeams = false }: { pollTeams?: boolean } = {}) {
  const [storedId, setStoredId] = useState<string | null>(null);
  const workspacesQuery = useWorkspaces(pollTeams && storedId !== null);
  const queryClient = useQueryClient();

  useEffect(() => {
    let alive = true;
    void getSettings().then((settings) => {
      if (alive) setStoredId(settings.activeWorkspaceId);
    });
    const unsubscribe = subscribeSettings((settings) => {
      if (alive) setStoredId(settings.activeWorkspaceId);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const { active, scopeId, stale } = resolveWorkspaceScope(
    storedId,
    workspacesQuery.isSuccess ? workspacesQuery.data : undefined,
  );

  // 목록이 바뀌어 팀이 사라지면 그 이름은 캐시에 없다. 안내에 쓰려고 마지막으로 본 팀을 기억한다.
  const lastActive = useRef<Workspace | null>(null);
  if (active) lastActive.current = active;

  useEffect(() => {
    if (!stale || !storedId) return;
    const name = lastActive.current?.id === storedId ? lastActive.current.name : undefined;
    void confirmTeamAccess(queryClient, storedId, name);
  }, [stale, storedId, queryClient]);

  const select = (workspaceId: string | null) => {
    setStoredId(workspaceId);
    void updateSettings({ activeWorkspaceId: workspaceId });
  };

  return {
    workspaces: workspacesQuery.data ?? [],
    active,
    /** 요청에 쓸 팀 id. null 이면 개인 기록이다. */
    scopeId,
    select,
  };
}
