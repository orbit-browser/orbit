import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  rerankEnabled: boolean;
  excludeSensitive: boolean;
  setRerankEnabled: (v: boolean) => void;
  setExcludeSensitive: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      rerankEnabled: false,
      excludeSensitive: true,
      setRerankEnabled: (rerankEnabled) => set({ rerankEnabled }),
      setExcludeSensitive: (excludeSensitive) => set({ excludeSensitive }),
    }),
    { name: 'orbit-settings' },
  ),
);
