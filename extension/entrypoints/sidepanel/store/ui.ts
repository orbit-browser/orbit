import { create } from 'zustand';

export type View = 'sessions' | 'search' | 'summary' | 'settings' | 'detail';

interface UIState {
  activeView: View;
  selectedSessionId: string | null;
  toast: string | null;
  setView: (view: View) => void;
  openSession: (id: string) => void;
  goBackToSessions: () => void;
  showToast: (message: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  activeView: 'sessions',
  selectedSessionId: null,
  toast: null,
  setView: (view) => set({ activeView: view }),
  openSession: (id) => set({ selectedSessionId: id, activeView: 'detail' }),
  goBackToSessions: () => set({ activeView: 'sessions' }),
  showToast: (message) => {
    set({ toast: message });
    setTimeout(() => set({ toast: null }), 1800);
  },
}));
