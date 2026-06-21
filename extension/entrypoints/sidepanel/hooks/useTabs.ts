import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCurrentWindowTabs } from '../../../lib/chrome-bridge';

// 탭 변경 이벤트는 background.ts에서 감지하고 TABS_CHANGED 메시지로 알려줌.
// 여기서는 그 메시지를 받아 쿼리를 무효화만 함.
let listenerRegistered = false;

export function useTabs() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;
    if (listenerRegistered) return;
    listenerRegistered = true;

    const listener = (message: { type: string }) => {
      if (message.type === 'TABS_CHANGED') {
        void queryClient.invalidateQueries({ queryKey: ['current-tabs'] });
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      listenerRegistered = false;
    };
  }, [queryClient]);

  return useQuery({
    queryKey: ['current-tabs'],
    queryFn: getCurrentWindowTabs,
    staleTime: 0,
    refetchInterval: 2000, // 메시지 누락 대비 안전망
  });
}
