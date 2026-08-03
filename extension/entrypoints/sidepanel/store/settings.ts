import { create } from 'zustand';
import {
  DEFAULT_SETTINGS,
  getSettings,
  migrateLegacySettings,
  subscribeSettings,
  updateSettings,
  type OrbitSettings,
} from '../../../lib/settings';

interface SettingsState extends OrbitSettings {
  setRerankEnabled: (v: boolean) => void;
  setExcludeSensitive: (v: boolean) => void;
  setCollectionEnabled: (v: boolean) => void;
  setContentCapture: (v: boolean) => void;
  setAutoSyncEnabled: (v: boolean) => void;
  setAutoSyncIntervalMin: (v: 15 | 30 | 60) => void;
  setIdleSyncMin: (v: number) => void;
  setCountThreshold: (v: number) => void;
}

// chrome.storage.local(lib/settings.ts)을 진실 원천으로 삼는 메모리 캐시.
// hydrate 전 기본값은 DEFAULT_SETTINGS — 초기 렌더가 잠깐 기본값을 보여준 뒤 실제 값으로 갱신된다.
export const useSettingsStore = create<SettingsState>()((set) => ({
  ...DEFAULT_SETTINGS,
  setRerankEnabled: (rerankEnabled) => {
    set({ rerankEnabled });
    void updateSettings({ rerankEnabled });
  },
  setExcludeSensitive: (excludeSensitive) => {
    set({ excludeSensitive });
    void updateSettings({ excludeSensitive });
  },
  setCollectionEnabled: (collectionEnabled) => {
    set({ collectionEnabled });
    void updateSettings({ collectionEnabled });
  },
  setContentCapture: (contentCapture) => {
    set({ contentCapture });
    void updateSettings({ contentCapture });
  },
  setAutoSyncEnabled: (autoSyncEnabled) => {
    set({ autoSyncEnabled });
    void updateSettings({ autoSyncEnabled });
  },
  setAutoSyncIntervalMin: (autoSyncIntervalMin) => {
    set({ autoSyncIntervalMin });
    void updateSettings({ autoSyncIntervalMin });
  },
  setIdleSyncMin: (idleSyncMin) => {
    set({ idleSyncMin });
    void updateSettings({ idleSyncMin });
  },
  setCountThreshold: (countThreshold) => {
    set({ countThreshold });
    void updateSettings({ countThreshold });
  },
}));

// 사이드패널 초기화 경로 — localStorage 값이 남아 있으면 1회 이관한 뒤 chrome.storage로 hydrate.
// localStorage는 사이드패널 컨텍스트에서만 접근 가능하므로 마이그레이션은 여기서만 호출한다.
void (async () => {
  await migrateLegacySettings();
  useSettingsStore.setState(await getSettings());
})();

// 다른 컨텍스트(SW 등)에서 설정이 바뀌면 스토어에 반영한다.
subscribeSettings((settings) => useSettingsStore.setState(settings));
