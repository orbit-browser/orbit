import { useQuery } from '@tanstack/react-query';
import { getCurrentWindowTabs } from '../../../lib/chrome-bridge';

// 현재 창에 열린 실제 탭 (chrome.tabs) — mock 이 아닌 실데이터.
export function useTabs() {
  return useQuery({
    queryKey: ['current-tabs'],
    queryFn: getCurrentWindowTabs,
    staleTime: 0,
  });
}
