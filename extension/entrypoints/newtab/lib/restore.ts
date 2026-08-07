/**
 * 세션 복원 — 세션에 속한 페이지를 탭으로 다시 연다.
 *
 * 사이드패널이 쓰는 `lib/chrome-bridge.ts` 의 구현을 그대로 재사용한다.
 * 두 화면이 같은 복원 동작을 갖도록 하기 위함이다.
 */

import { restoreInCurrentWindow, restoreInNewWindow } from '../../../lib/chrome-bridge';
import type { SessionNode } from '../components/atlas/data';

export type RestoreTarget = 'current' | 'new-window';

/**
 * 실패를 문자열로 돌려준다(성공이면 null).
 * 탭이 열리지 않았는데 아무 반응이 없으면 사용자는 버튼이 고장난 것으로만 본다.
 */
export async function restoreSession(
  session: SessionNode,
  target: RestoreTarget,
): Promise<string | null> {
  const urls = session.pages.map((page) => page.url);
  if (urls.length === 0) return '복원할 페이지가 없어요.';

  try {
    if (target === 'new-window') await restoreInNewWindow(urls);
    else await restoreInCurrentWindow(urls);
    return null;
  } catch (err) {
    console.error('[Orbit] 세션 복원 실패', err);
    return '세션을 복원하지 못했어요.';
  }
}
