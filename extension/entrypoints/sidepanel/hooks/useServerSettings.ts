import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchServerSettings, updateServerSettings } from '../../../lib/api';

export function useServerSettings() {
  return useQuery({
    queryKey: ['server-settings'],
    queryFn: fetchServerSettings,
    retry: false,
  });
}

export function useUpdateServerSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateServerSettings,
    onSuccess: (data) => queryClient.setQueryData(['server-settings'], data),
  });
}
