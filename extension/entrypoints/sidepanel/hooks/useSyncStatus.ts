// SyncStatusCard가 구독하는 orbit:syncStatus 요약 훅.
// chrome.storage.local을 진실 원천으로 읽고, chrome.storage.onChanged로 다른 컨텍스트
// (SW의 collector/sync 엔진)가 쓴 변경을 감지해 TanStack Query를 무효화한다.
// 계약 근거: docs/target-architecture.md §3, extension/lib/events/queue.ts(writeSyncStatusSummary)

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getSyncStatus } from '../../../lib/events/queue';

export const SYNC_STATUS_QUERY_KEY = ['orbit-sync-status'] as const;
const SYNC_STATUS_STORAGE_KEY = 'orbit:syncStatus';

function hasStorageChangeApi(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.onChanged;
}

/** SyncStatusCard/useTimeline이 공유하는 무효화 훅 — orbit:syncStatus가 바뀔 때마다 콜백을 부른다. */
export function useSyncStatusInvalidation(onChange: () => void): void {
  useEffect(() => {
    if (!hasStorageChangeApi()) return;
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'local' || !(SYNC_STATUS_STORAGE_KEY in changes)) return;
      onChange();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [onChange]);
}

export function useSyncStatus() {
  const queryClient = useQueryClient();

  useSyncStatusInvalidation(() => {
    queryClient.invalidateQueries({ queryKey: SYNC_STATUS_QUERY_KEY });
  });

  return useQuery({
    queryKey: SYNC_STATUS_QUERY_KEY,
    queryFn: getSyncStatus,
    staleTime: 0,
  });
}

/** "세션 분류" 버튼 — SW의 sync/triggers.ts(SYNC_NOW 핸들러)로 수동 동기화를 요청한다. */
export async function triggerManualSync(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
  await chrome.runtime.sendMessage({ type: 'SYNC_NOW' });
}
