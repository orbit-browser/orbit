import type { TabItem } from '../types';

// chrome.tabs 권한이 없거나(예: 일부 dev 환경) 빈 경우의 폴백 표시용 mock.
// 실제로는 chrome-bridge.getCurrentWindowTabs() 가 실데이터를 반환합니다.
export const mockTabs: TabItem[] = [
  { id: 'm1', title: 'Google', url: 'https://www.google.com' },
  { id: 'm2', title: 'ChatGPT – OpenAI', url: 'https://chat.openai.com' },
  { id: 'm3', title: 'GitHub', url: 'https://github.com' },
];
