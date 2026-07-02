import { useQuery } from '@tanstack/react-query';
import { searchSessions } from '../../../lib/api';
import { useSettingsStore } from '../store/settings';

export function useSearch(query: string) {
  const rerankEnabled = useSettingsStore((s) => s.rerankEnabled);
  const trimmed = query.trim();
  return useQuery({
    queryKey: ['search', trimmed, rerankEnabled],
    queryFn: () => searchSessions(trimmed, rerankEnabled),
    enabled: trimmed.length > 0,
  });
}

