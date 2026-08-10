import { create } from 'zustand';

/**
 * 사이드패널은 macOS 제어 센터를 따른다 — 홈은 위젯 격자 하나이고,
 * 각 기능은 격자 위로 덮이는 시트로 열린다. 시트는 스택이라 되돌아갈 경로가 남는다.
 *
 * 세션 상세는 시트를 새로 쌓지 않고 목록 **안에서** 펼친다. 목록에서 하나를 고르는 일은
 * 다른 화면으로 가는 것이 아니라 그 항목을 자세히 보는 것이기 때문이다.
 */
export type Sheet =
  | { kind: 'open-tabs' }
  | { kind: 'timeline' }
  | { kind: 'sessions' }
  | { kind: 'merge' }
  | { kind: 'ask' }
  | { kind: 'settings' };

export type SheetKind = Sheet['kind'];

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastState {
  message: string;
  action?: ToastAction;
}

interface UIState {
  sheets: Sheet[];
  /** 저장된 세션 시트에서 펼쳐 놓은 세션. 목록 안에서 펼쳐지므로 시트를 새로 쌓지 않는다. */
  expandedSessionId: string | null;
  toast: ToastState | null;
  pendingSessionIds: string[];
  isClustering: boolean;
  searchQuery: string;
  openSheet: (sheet: Sheet) => void;
  closeSheet: () => void;
  closeAllSheets: () => void;
  openSession: (id: string) => void;
  collapseSession: () => void;
  showToast: (message: string, action?: ToastAction) => void;
  dismissToast: () => void;
  addPendingSession: (id: string) => void;
  removePendingSession: (id: string) => void;
  startClustering: () => void;
  stopClustering: () => void;
  setSearchQuery: (q: string) => void;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

function isSameSheet(a: Sheet, b: Sheet): boolean {
  return a.kind === b.kind;
}

export const useUIStore = create<UIState>((set) => ({
  sheets: [],
  expandedSessionId: null,
  toast: null,
  pendingSessionIds: [],
  isClustering: false,
  searchQuery: '',

  // 같은 시트를 다시 열면 스택을 늘리지 않는다 — 타일을 두 번 눌러도 뒤로가기가 어긋나지 않게.
  openSheet: (sheet) =>
    set((s) => {
      const top = s.sheets.at(-1);
      if (top && isSameSheet(top, sheet)) return s;
      return { sheets: [...s.sheets, sheet] };
    }),
  // 세션 시트를 벗어나면 펼침 상태도 함께 접는다 — 다시 열었을 때 목록부터 보이도록.
  closeSheet: () =>
    set((s) => {
      const sheets = s.sheets.slice(0, -1);
      const leftSessions = s.sheets.at(-1)?.kind === 'sessions';
      return leftSessions ? { sheets, expandedSessionId: null } : { sheets };
    }),
  closeAllSheets: () => set({ sheets: [], expandedSessionId: null }),

  // 타임라인 배지·Ask 답변 등 어디서 불러도 목록 시트를 열고 그 안에서 펼친다.
  // 목록이 이미 열려 있으면 다시 쌓지 않는다.
  openSession: (id) =>
    set((s) => ({
      sheets: s.sheets.some((sheet) => sheet.kind === 'sessions')
        ? s.sheets
        : [...s.sheets, { kind: 'sessions' } as Sheet],
      expandedSessionId: id,
    })),
  collapseSession: () => set({ expandedSessionId: null }),

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
