import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchSettings, updateSettings } from '../lib/api';

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateSettings,
    // 서버가 반환한 확정 상태로 캐시를 즉시 갱신(토글 반영 지연 없이)
    onSuccess: (data) => queryClient.setQueryData(['settings'], data),
  });
}
