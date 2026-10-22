import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createWorkspace,
  deleteWorkspace,
  fetchWorkspaceMembers,
  fetchWorkspaceSessions,
  issueInviteCode,
  joinWorkspace,
  removeWorkspaceMember,
  renameWorkspace,
  shareSessions,
  unshareSession,
} from '../../../lib/api';
import { getSession } from '../../../lib/auth';
import { getSettings, updateSettings } from '../../../lib/settings';
import { WORKSPACES_QUERY_KEY } from '../../../lib/useWorkspaces';

export function useWorkspaceSessions(workspaceId: string | null) {
  return useQuery({
    queryKey: ['workspace-sessions', workspaceId],
    queryFn: () => fetchWorkspaceSessions(workspaceId as string),
    enabled: !!workspaceId,
    refetchInterval: 15_000,
  });
}

export function useWorkspaceMembers(workspaceId: string | null) {
  return useQuery({
    queryKey: ['workspace-members', workspaceId],
    queryFn: () => fetchWorkspaceMembers(workspaceId as string),
    enabled: !!workspaceId,
  });
}

/**
 * 팀 변경 뮤테이션 묶음. 낙관적 갱신은 하지 않는다 — 공유는 서버가 소유권을 확인한 뒤
 * 일부만 반영될 수 있어(skipped) 화면이 앞서가면 실제 결과와 어긋난다.
 */
export function useWorkspaceMutations() {
  const queryClient = useQueryClient();
  const invalidateTeams = () => queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY });
  // 공유 상태는 내 세션 목록의 배지와 팀 목록 양쪽에 걸쳐 있다.
  const invalidateShares = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['sessions'] }),
      queryClient.invalidateQueries({ queryKey: ['workspace-sessions'] }),
    ]);
  // 그 팀의 캐시(아틀라스·멤버·팀 세션)를 버린다. 다시 참여했을 때 staleTime 안의 옛 공유 상태가 보이면 안 된다.
  const dropTeamCache = (workspaceId: string) =>
    queryClient.removeQueries({ predicate: (query) => query.queryKey.includes(workspaceId) });
  /**
   * 나가거나 지운 팀이 지금 범위면 개인으로 돌린다. 이 일을 mutate 단위 콜백(화면)에 맡기면
   * 팀 목록을 다시 받는 사이 그 화면이 언마운트돼 콜백이 버려진다. 저장값을 바꾸면 설정 구독이
   * Ask 대화를 비운다. 목록을 다시 받기 전에 해야 화면이 사라진 팀을 가리키지 않는다.
   */
  const forgetTeam = async (workspaceId: string) => {
    const settings = await getSettings();
    if (settings.activeWorkspaceId === workspaceId) await updateSettings({ activeWorkspaceId: null });
    dropTeamCache(workspaceId);
  };

  return {
    create: useMutation({ mutationFn: createWorkspace, onSuccess: invalidateTeams }),
    join: useMutation({
      mutationFn: joinWorkspace,
      onSuccess: (team) => {
        dropTeamCache(team.id);
        return invalidateTeams();
      },
    }),
    rename: useMutation({
      mutationFn: ({ workspaceId, name }: { workspaceId: string; name: string }) =>
        renameWorkspace(workspaceId, name),
      onSuccess: invalidateTeams,
    }),
    remove: useMutation({
      mutationFn: deleteWorkspace,
      onSuccess: async (_data, workspaceId) => {
        await forgetTeam(workspaceId);
        await Promise.all([invalidateTeams(), invalidateShares()]);
      },
    }),
    issueInvite: useMutation({ mutationFn: issueInviteCode }),
    removeMember: useMutation({
      mutationFn: ({ workspaceId, userId }: { workspaceId: string; userId: string }) =>
        removeWorkspaceMember(workspaceId, userId),
      onSuccess: async (_data, { workspaceId, userId }) => {
        const self = (await getSession())?.user.id === userId;
        if (self) await forgetTeam(workspaceId);
        await Promise.all([
          invalidateTeams(),
          invalidateShares(),
          self ? undefined : queryClient.invalidateQueries({ queryKey: ['workspace-members', workspaceId] }),
        ]);
      },
    }),
    share: useMutation({
      mutationFn: ({ workspaceId, sessionIds }: { workspaceId: string; sessionIds: string[] }) =>
        shareSessions(workspaceId, sessionIds),
      onSuccess: invalidateShares,
    }),
    unshare: useMutation({
      mutationFn: ({ workspaceId, sessionId }: { workspaceId: string; sessionId: string }) =>
        unshareSession(workspaceId, sessionId),
      onSuccess: invalidateShares,
    }),
  };
}
