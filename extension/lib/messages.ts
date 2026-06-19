// 사이드패널 ↔ background(Service Worker) 메시지 타입 정의.
// 현재 사이드패널은 chrome.tabs 를 직접 호출하므로 이 채널은 골격입니다.
// 후속 단계(백엔드 분석/Agent Action)에서 SW 경유 처리가 늘어납니다.

import type { TabItem } from './types';

export type OrbitMessage = { type: 'GET_CURRENT_TABS' } | { type: 'PING' };

export interface GetCurrentTabsResponse {
  tabs: TabItem[];
}
