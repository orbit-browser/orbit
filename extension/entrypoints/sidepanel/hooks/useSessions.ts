import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchSession,
  fetchSessions,
  saveSession,
  saveSessionsClustered,
  renameSession,
  deleteSession,
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

export function useSaveSession() {
  const queryClient = useQueryClient();
  const addPending = useUIStore((s) => s.addPendingSession);
  return useMutation({
    mutationFn: (tabs: TabItem[]) => saveSession(tabs),
    onSuccess: (session) => {
      addPending(session.id);
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
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

/** AI 요약이 완료될 때까지 pending 세션을 3초마다 폴링. */
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
          if (!session) {
            removePending(id);
            queryClient.invalidateQueries({ queryKey: ['sessions'] });
            continue;
          }

          const created = new Date(session.createdAt).getTime();
          const updated = new Date(session.updatedAt).getTime();
          const overview = session.summary?.overview ?? '';
          
          // "X개 탭 세션" 형식인 임시 overview 문구인지 체크
          const isTempOverview = /^\d+개 탭 세션$/.test(overview);
          
          // 임시 overview가 아니고, 갱신 시각이 생성 시각보다 최소 1초 이상 늦거나 문구가 완전히 변했을 때
          const isAiSummaryReady = !isTempOverview && (updated - created > 1000 || !overview.includes('개 탭 세션'));

          if (isAiSummaryReady) {
            removePending(id);
            queryClient.invalidateQueries({ queryKey: ['sessions'] });
          }
        } catch {
          removePending(id);
        }
      }
    }, 3000);

    return () => clearInterval(timer);
  }, [pendingIds, removePending, queryClient]);
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
