import { create } from 'zustand';

export type View = 'timeline' | 'sessions' | 'search' | 'settings' | 'detail';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastState {
  message: string;
  action?: ToastAction;
}

interface UIState {
  activeView: View;
  selectedSessionId: string | null;
  toast: ToastState | null;
  pendingSessionIds: string[];
  isClustering: boolean;
  searchQuery: string;
  setView: (view: View) => void;
  openSession: (id: string) => void;
  goBackToSessions: () => void;
  showToast: (message: string, action?: ToastAction) => void;
  dismissToast: () => void;
  addPendingSession: (id: string) => void;
  removePendingSession: (id: string) => void;
  startClustering: () => void;
  stopClustering: () => void;
  setSearchQuery: (q: string) => void;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useUIStore = create<UIState>((set) => ({
  activeView: 'timeline',
  selectedSessionId: null,
  toast: null,
  pendingSessionIds: [],
  isClustering: false,
  searchQuery: '',
  setView: (view) => set({ activeView: view }),
  openSession: (id) => set({ selectedSessionId: id, activeView: 'detail' }),
  goBackToSessions: () => set({ activeView: 'sessions' }),
  showToast: (message, action) => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: { message, action } });
    toastTimer = setTimeout(() => {
      set({ toast: null });
      toastTimer = null;
    }, action ? 6000 : 2000);
  },
  dismissToast: () => {
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = null;
    set({ toast: null });
  },
  addPendingSession: (id) =>
    set((s) => ({ pendingSessionIds: [...s.pendingSessionIds, id] })),
  removePendingSession: (id) =>
    set((s) => ({ pendingSessionIds: s.pendingSessionIds.filter((x) => x !== id) })),
  startClustering: () => set({ isClustering: true }),
  stopClustering: () => set({ isClustering: false }),
  setSearchQuery: (q) => set({ searchQuery: q }),
}));
