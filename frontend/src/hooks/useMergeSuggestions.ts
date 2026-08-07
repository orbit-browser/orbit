import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchMergeSuggestions, mergeSessions, unmergeSessions } from '../lib/api';

interface MergeVars {
  survivorId: string;
  absorbedId: string;
}

export function useMergeSuggestions() {
  return useQuery({
    queryKey: ['merge-suggestions'],
    queryFn: fetchMergeSuggestions,
  });
}

// 병합/되돌리기는 여러 세션에 영향을 주므로 sessions 목록과 제안, 관련 단건 캐시를 모두 무효화한다.
function invalidateAll(
  queryClient: ReturnType<typeof useQueryClient>,
  { survivorId, absorbedId }: MergeVars,
) {
  queryClient.invalidateQueries({ queryKey: ['sessions'] });
  queryClient.invalidateQueries({ queryKey: ['merge-suggestions'] });
  queryClient.invalidateQueries({ queryKey: ['session', survivorId] });
  queryClient.invalidateQueries({ queryKey: ['session', absorbedId] });
}

export function useMergeSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ survivorId, absorbedId }: MergeVars) => mergeSessions(survivorId, absorbedId),
    onSuccess: (_data, vars) => invalidateAll(queryClient, vars),
  });
}

export function useUnmergeSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ survivorId, absorbedId }: MergeVars) => unmergeSessions(survivorId, absorbedId),
    onSuccess: (_data, vars) => invalidateAll(queryClient, vars),
  });
}
