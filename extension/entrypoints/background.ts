export default defineBackground(() => {
  // 액션 아이콘 클릭 시 사이드패널 열기
  chrome.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error('[Orbit] sidePanel 설정 실패', err));

  // 메시지 라우팅 골격 (후속: 백엔드 분석 / Agent Action 경유)
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'GET_CURRENT_TABS') {
      chrome.tabs.query({ currentWindow: true }).then((tabs) => sendResponse({ tabs }));
      return true; // 비동기 응답
    }
    return false;
  });
});
