/**
 * 세션 변경 브로드캐스트 — 사이드패널에서 한 일을 새 탭이 바로 알도록.
 *
 * 두 화면은 서로 다른 확장 페이지라 React 상태를 공유하지 않는다.
 * 사이드패널에서 병합해도 새 탭은 자기 캐시를 들고 있어 새로고침 전까지 옛 목록을 보여준다.
 * `chrome.runtime.sendMessage` 는 열려 있는 모든 확장 페이지에 닿으므로 이걸로 알린다.
 */

export type SessionChange =
  | { type: 'sessions:merged'; survivorId: string; absorbedId: string }
  | { type: 'sessions:unmerged'; survivorId: string; absorbedId: string }
  | { type: 'sessions:changed' };

/**
 * 변경을 알린다.
 *
 * 받는 쪽이 하나도 없으면 크롬이 "Receiving end does not exist" 로 거부하는데,
 * 이는 정상 상황(새 탭이 안 열려 있음)이라 조용히 무시한다.
 */
export function broadcastSessionChange(change: SessionChange): void {
  try {
    void chrome.runtime.sendMessage(change).catch(() => {});
  } catch {
    // 확장 컨텍스트 밖(테스트) — 무시
  }
}

/** 변경 구독. 해제 함수를 돌려준다. */
export function onSessionChange(listener: (change: SessionChange) => void): () => void {
  const handler = (message: unknown) => {
    if (
      typeof message === 'object' &&
      message !== null &&
      typeof (message as SessionChange).type === 'string' &&
      (message as SessionChange).type.startsWith('sessions:')
    ) {
      listener(message as SessionChange);
    }
  };

  try {
    chrome.runtime.onMessage.addListener(handler);
  } catch {
    return () => {};
  }
  return () => {
    try {
      chrome.runtime.onMessage.removeListener(handler);
    } catch {
      // 이미 정리됨
    }
  };
}
