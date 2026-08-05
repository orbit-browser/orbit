import { useQuery } from '@tanstack/react-query';
import { fetchAnalyticsOverview } from '../lib/api';

export function useAnalyticsOverview(days: number) {
  return useQuery({
    queryKey: ['analytics-overview', days],
    queryFn: () => fetchAnalyticsOverview(days),
  });
}
