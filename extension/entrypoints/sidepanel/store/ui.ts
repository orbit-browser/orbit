import { create } from 'zustand';

export type View = 'sessions' | 'search' | 'settings' | 'detail';

interface UIState {
  activeView: View;
  selectedSessionId: string | null;
  toast: string | null;
  pendingSessionIds: string[];
  isClustering: boolean;
  searchQuery: string;
  setView: (view: View) => void;
  openSession: (id: string) => void;
  goBackToSessions: () => void;
  showToast: (message: string) => void;
  addPendingSession: (id: string) => void;
  removePendingSession: (id: string) => void;
  startClustering: () => void;
  stopClustering: () => void;
  setSearchQuery: (q: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  activeView: 'sessions',
  selectedSessionId: null,
  toast: null,
  pendingSessionIds: [],
  isClustering: false,
  searchQuery: '',
  setView: (view) => set({ activeView: view }),
  openSession: (id) => set({ selectedSessionId: id, activeView: 'detail' }),
  goBackToSessions: () => set({ activeView: 'sessions' }),
  showToast: (message) => {
    set({ toast: message });
    setTimeout(() => set({ toast: null }), 1800);
  },
  addPendingSession: (id) =>
    set((s) => ({ pendingSessionIds: [...s.pendingSessionIds, id] })),
  removePendingSession: (id) =>
    set((s) => ({ pendingSessionIds: s.pendingSessionIds.filter((x) => x !== id) })),
  startClustering: () => set({ isClustering: true }),
  stopClustering: () => set({ isClustering: false }),
  setSearchQuery: (q) => set({ searchQuery: q }),
}));
