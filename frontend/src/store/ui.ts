import { create } from 'zustand';

interface UIState {
  selectedSessionId: string | null;
  toast: string | null;
  openSession: (id: string) => void;
  closeSession: () => void;
  showToast: (message: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  selectedSessionId: null,
  toast: null,
  openSession: (id) => set({ selectedSessionId: id }),
  closeSession: () => set({ selectedSessionId: null }),
  showToast: (message) => {
    set({ toast: message });
    setTimeout(() => set({ toast: null }), 2000);
  },
}));
