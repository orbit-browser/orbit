import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchSession,
  fetchSessions,
  saveSession,
  renameSession,
  deleteSession,
} from '../../../lib/api';
import type { TabItem } from '../../../lib/types';

export function useSessions() {
  return useQuery({ queryKey: ['sessions'], queryFn: fetchSessions });
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
  return useMutation({
    mutationFn: (tabs: TabItem[]) => saveSession(tabs),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
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
