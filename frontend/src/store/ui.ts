import { create } from 'zustand';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastState {
  message: string;
  action?: ToastAction;
}

interface UIState {
  selectedSessionId: string | null;
  toast: ToastState | null;
  openSession: (id: string) => void;
  closeSession: () => void;
  showToast: (message: string, action?: ToastAction) => void;
}

export const useUIStore = create<UIState>((set) => ({
  selectedSessionId: null,
  toast: null,
  openSession: (id) => set({ selectedSessionId: id }),
  closeSession: () => set({ selectedSessionId: null }),
  showToast: (message, action) => {
    set({ toast: { message, action } });
    // 되돌리기 등 액션이 있으면 사용자가 누를 시간을 더 준다.
    setTimeout(() => set({ toast: null }), action ? 6000 : 2000);
  },
}));
