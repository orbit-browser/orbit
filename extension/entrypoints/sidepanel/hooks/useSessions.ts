import { useQuery } from '@tanstack/react-query';
import { fetchSession, fetchSessions } from '../../../lib/api';

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
