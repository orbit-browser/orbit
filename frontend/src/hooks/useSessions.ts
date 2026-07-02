import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchSession,
  fetchSessions,
  searchSessions,
  renameSession,
  deleteSession,
  retrySummary,
} from '../lib/api';
import type { Session } from '../lib/types';

// AI 요약이 아직 진행 중인 세션이 있으면 3초 간격으로 재조회 (Extension의 pending 폴링과 동일한 개념)
function pendingRefetchInterval(sessions: Session[] | undefined): number | false {
  return sessions?.some((s) => s.summaryStatus === 'pending') ? 3000 : false;
}

export function useSessions() {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: fetchSessions,
    refetchInterval: (query) => pendingRefetchInterval(query.state.data),
  });
}

export function useSession(id: string | null) {
  return useQuery({
    queryKey: ['session', id],
    queryFn: () => fetchSession(id as string),
    enabled: !!id,
    refetchInterval: (query) =>
      query.state.data?.summaryStatus === 'pending' ? 3000 : false,
  });
}

export function useRetrySummary() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => retrySummary(id),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['session', session.id] });
    },
  });
}

export function useSearch(query: string) {
  return useQuery({
    queryKey: ['search', query],
    queryFn: () => searchSessions(query),
    enabled: query.trim().length > 0,
  });
}

export function useRenameSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      renameSession(id, title),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['session', id] });
    },
  });
}

export function useDeleteSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteSession(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  });
}
