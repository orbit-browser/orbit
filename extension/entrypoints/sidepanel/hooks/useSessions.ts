import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchSession,
  fetchSessions,
  saveSessionsClustered,
  renameSession,
  deleteSession,
  retrySummary,
} from '../../../lib/api';
import type { TabItem } from '../../../lib/types';
import { useUIStore } from '../store/ui';

export function useSessions() {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: fetchSessions,
    refetchInterval: 15_000,
  });
}

export function useSession(id: string | null) {
  return useQuery({
    queryKey: ['session', id],
    queryFn: () => fetchSession(id as string),
    enabled: !!id,
  });
}

export function useSaveSessionsClustered() {
  const queryClient = useQueryClient();
  const addPending = useUIStore((s) => s.addPendingSession);
  return useMutation({
    mutationFn: (tabs: TabItem[]) => saveSessionsClustered(tabs),
    onSuccess: (sessions) => {
      sessions.forEach((s) => addPending(s.id));
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

/** AI 요약이 끝날 때까지(done 또는 failed) pending 세션을 3초마다 폴링. */
export function usePendingSessionPoller() {
  const pendingIds = useUIStore((s) => s.pendingSessionIds);
  const removePending = useUIStore((s) => s.removePendingSession);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!pendingIds.length) return;

    const timer = setInterval(async () => {
      for (const id of pendingIds) {
        try {
          const session = await fetchSession(id);
          if (!session || session.summaryStatus !== 'pending') {
            removePending(id);
            queryClient.invalidateQueries({ queryKey: ['sessions'] });
            queryClient.invalidateQueries({ queryKey: ['session', id] });
          }
        } catch {
          // 일시적인 연결 오류에서는 pending을 유지해 다음 주기에 다시 확인한다.
        }
      }
    }, 3000);

    return () => clearInterval(timer);
  }, [pendingIds, removePending, queryClient]);
}

/** 요약 생성 실패(summaryStatus === 'failed') 세션을 재시도. */
export function useRetrySummary() {
  const queryClient = useQueryClient();
  const addPending = useUIStore((s) => s.addPendingSession);
  return useMutation({
    mutationFn: (id: string) => retrySummary(id),
    onSuccess: (session) => {
      addPending(session.id);
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['session', session.id] });
    },
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
