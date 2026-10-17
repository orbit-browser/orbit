import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchWorkspaces } from './api';
import { getSettings, subscribeSettings, updateSettings } from './settings';
import type { Workspace } from './types';

export const WORKSPACES_QUERY_KEY = ['workspaces'] as const;

export function useWorkspaces() {
  return useQuery({ queryKey: WORKSPACES_QUERY_KEY, queryFn: fetchWorkspaces });
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
 * 다른 계정으로 로그인했거나 팀이 지워짐)을 가리키면 개인 화면을 그린다 — 그대로 두면 모든 팀
 * 요청이 404 로 비어 보인다. 저장값은 지우지 않는다: 다른 화면에서 방금 참여한 팀일 수 있어서
 * (이 화면의 목록만 낡았다) 목록을 다시 받아 본다. 저장값은 다음 선택이 덮어쓴다.
 */
export function useActiveWorkspace() {
  const [storedId, setStoredId] = useState<string | null>(null);
  const workspacesQuery = useWorkspaces();

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

  const { refetch } = workspacesQuery;
  useEffect(() => {
    if (stale) void refetch();
  }, [stale, refetch]);

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
