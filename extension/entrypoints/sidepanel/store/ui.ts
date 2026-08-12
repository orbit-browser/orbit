import { create } from 'zustand';

export type View = 'timeline' | 'sessions' | 'tabs' | 'settings' | 'detail';

/** 하단 Ask 독을 띄우는 화면. 상세·설정에서는 대화를 걸 대상이 없어 숨긴다. */
const ASK_DOCK_VIEWS: View[] = ['timeline', 'sessions', 'tabs'];

export const isAskDockView = (view: View) => ASK_DOCK_VIEWS.includes(view);

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
  /** Ask 답변 화면이 현재 탭 위로 올라와 있는지 */
  askOpen: boolean;
  setView: (view: View) => void;
  openSession: (id: string) => void;
  goBackToSessions: () => void;
  showToast: (message: string, action?: ToastAction) => void;
  dismissToast: () => void;
  addPendingSession: (id: string) => void;
  removePendingSession: (id: string) => void;
  openAsk: () => void;
  closeAsk: () => void;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useUIStore = create<UIState>((set) => ({
  activeView: 'timeline',
  selectedSessionId: null,
  toast: null,
  pendingSessionIds: [],
  askOpen: false,
  setView: (view) => set({ activeView: view }),
  // 상세로 넘어가면 답변 화면은 닫는다 — 상세에는 독이 없어 되돌릴 방법이 사라진다.
  openSession: (id) => set({ selectedSessionId: id, activeView: 'detail', askOpen: false }),
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
  openAsk: () => set({ askOpen: true }),
  closeAsk: () => set({ askOpen: false }),
}));
