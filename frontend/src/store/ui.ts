import { create } from 'zustand';

export type View = 'sessions' | 'search';

interface UIState {
  activeView: View;
  selectedSessionId: string | null;
  toast: string | null;
  setView: (view: View) => void;
  openSession: (id: string) => void;
  closeSession: () => void;
  showToast: (message: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  activeView: 'sessions',
  selectedSessionId: null,
  toast: null,
  setView: (view) => set({ activeView: view, selectedSessionId: null }),
  openSession: (id) => set({ selectedSessionId: id }),
  closeSession: () => set({ selectedSessionId: null }),
  showToast: (message) => {
    set({ toast: message });
    setTimeout(() => set({ toast: null }), 2000);
  },
}));
