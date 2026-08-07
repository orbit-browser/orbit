import { useEffect } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { getAllOpenTabs, getCurrentWindowTabs } from '../../../lib/chrome-bridge';

// 탭 변경 이벤트는 background.ts에서 감지하고 TABS_CHANGED 메시지로 알려줌.
// 여기서는 그 메시지를 받아 쿼리를 무효화만 함.
const queryClientRefs = new Map<QueryClient, number>();
let tabsChangedListener: ((message: { type?: string }) => void) | null = null;

function useTabsInvalidation() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;
    queryClientRefs.set(queryClient, (queryClientRefs.get(queryClient) ?? 0) + 1);
    if (!tabsChangedListener) {
      tabsChangedListener = (message) => {
        if (message.type !== 'TABS_CHANGED') return;
        queryClientRefs.forEach((_count, client) => {
          void client.invalidateQueries({ queryKey: ['current-tabs'] });
          void client.invalidateQueries({ queryKey: ['open-tabs'] });
        });
      };
      chrome.runtime.onMessage.addListener(tabsChangedListener);
    }

    return () => {
      const remainingRefs = (queryClientRefs.get(queryClient) ?? 1) - 1;
      if (remainingRefs > 0) queryClientRefs.set(queryClient, remainingRefs);
      else queryClientRefs.delete(queryClient);
      if (queryClientRefs.size === 0 && tabsChangedListener) {
        chrome.runtime.onMessage.removeListener(tabsChangedListener);
        tabsChangedListener = null;
      }
    };
  }, [queryClient]);
}

export function useTabs() {
  useTabsInvalidation();

  return useQuery({
    queryKey: ['current-tabs'],
    queryFn: getCurrentWindowTabs,
    staleTime: 0,
    refetchInterval: 2000, // 메시지 누락 대비 안전망
  });
}

export function useOpenTabs() {
  useTabsInvalidation();
  return useQuery({
    queryKey: ['open-tabs'],
    queryFn: getAllOpenTabs,
    staleTime: 0,
    refetchInterval: 2000,
  });
}
