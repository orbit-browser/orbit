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

  return {
    create: useMutation({ mutationFn: createWorkspace, onSuccess: invalidateTeams }),
    join: useMutation({ mutationFn: joinWorkspace, onSuccess: invalidateTeams }),
    rename: useMutation({
      mutationFn: ({ workspaceId, name }: { workspaceId: string; name: string }) =>
        renameWorkspace(workspaceId, name),
      onSuccess: invalidateTeams,
    }),
    remove: useMutation({
      mutationFn: deleteWorkspace,
      onSuccess: () => Promise.all([invalidateTeams(), invalidateShares()]),
    }),
    issueInvite: useMutation({ mutationFn: issueInviteCode }),
    removeMember: useMutation({
      mutationFn: ({ workspaceId, userId }: { workspaceId: string; userId: string }) =>
        removeWorkspaceMember(workspaceId, userId),
      onSuccess: (_data, { workspaceId }) =>
        Promise.all([
          invalidateTeams(),
          invalidateShares(),
          queryClient.invalidateQueries({ queryKey: ['workspace-members', workspaceId] }),
        ]),
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
