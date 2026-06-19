import { useQuery } from '@tanstack/react-query';
import { searchSessions } from '../../../lib/api';

export function useSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ['search', trimmed],
    queryFn: () => searchSessions(trimmed),
    enabled: trimmed.length > 0,
  });
}
