import { useEffect, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  getSettings,
  subscribeSettings,
  updateSettings,
  type OrbitSettings,
} from '../../../lib/settings';

/**
 * 새 탭에서 쓰는 로컬 설정.
 *
 * 진실 원천은 `chrome.storage.local`(lib/settings.ts)이라 사이드패널에서 바꿔도 여기가
 * 따라 바뀐다. 사이드패널의 zustand 스토어를 끌어다 쓰지 않는 이유는 그쪽 엔트리포인트에
 * 묶인 상태이기 때문이다 — 공유 계층(lib)만 본다.
 */
export function useOrbitSettings() {
  const [settings, setSettings] = useState<OrbitSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    let alive = true;
    void getSettings().then((value) => {
      if (alive) setSettings(value);
    });
    const unsubscribe = subscribeSettings((value) => {
      if (alive) setSettings(value);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  /** 낙관적으로 먼저 반영한다 — 저장이 끝날 때까지 스위치가 굳어 있으면 안 눌린 것처럼 보인다. */
  const patch = (partial: Partial<OrbitSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
    void updateSettings(partial);
  };

  return { settings, patch };
}
