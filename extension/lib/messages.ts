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
  | { type: 'PING' };

export interface GetCurrentTabsResponse {
  tabs: TabItem[];
}
