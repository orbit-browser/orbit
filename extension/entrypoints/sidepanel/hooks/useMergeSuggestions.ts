import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchMergeSuggestions,
  mergeSessions,
  unmergeSessions,
} from '../../../lib/api';
import type { MergePair } from '../../../lib/merge';

export function useMergeSuggestions() {
  return useQuery({
    queryKey: ['merge-suggestions'],
    queryFn: fetchMergeSuggestions,
  });
}

function invalidateMergeQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  { survivorId, absorbedId }: MergePair,
) {
  queryClient.invalidateQueries({ queryKey: ['sessions'] });
  queryClient.invalidateQueries({ queryKey: ['merge-suggestions'] });
  queryClient.invalidateQueries({ queryKey: ['session', survivorId] });
  queryClient.invalidateQueries({ queryKey: ['session', absorbedId] });
  queryClient.invalidateQueries({ queryKey: ['orbit-analytics-overview'] });
}

export function useMergeSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ survivorId, absorbedId }: MergePair) => mergeSessions(survivorId, absorbedId),
    onSuccess: (_data, pair) => invalidateMergeQueries(queryClient, pair),
  });
}

export function useUnmergeSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ survivorId, absorbedId }: MergePair) => unmergeSessions(survivorId, absorbedId),
    onSuccess: (_data, pair) => invalidateMergeQueries(queryClient, pair),
  });
}
