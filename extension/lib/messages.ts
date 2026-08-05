import type { SyncStatusSummary } from './events/queue';
import type { PageContent, TabItem } from './types';

export type OrbitMessage =
  | { type: 'GET_CURRENT_TABS' }
  | { type: 'TABS_CHANGED' }
  // content script → background: 페이지 추출 완료
  | { type: 'PAGE_CONTENT_READY'; content: PageContent | null }
  // background → content script: 온-디맨드 추출 요청
  | { type: 'EXTRACT_CONTENT' }
  // side panel → background: 특정 탭의 콘텐츠 조회
  | { type: 'GET_PAGE_CONTENT'; tabId: number }
  // side panel → background: 지금 즉시 동기화 트리거(수동)
  | { type: 'SYNC_NOW' }
  // side panel → background: orbit:syncStatus 폴백 조회
  | { type: 'GET_SYNC_STATUS' }
  | { type: 'PING' };

export interface GetCurrentTabsResponse {
  tabs: TabItem[];
}

export type SyncNowResponse = { ok: true };
export type GetSyncStatusResponse = SyncStatusSummary;
