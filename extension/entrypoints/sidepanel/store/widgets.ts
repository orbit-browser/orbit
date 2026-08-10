import { create } from 'zustand';
import {
  DEFAULT_LAYOUT,
  getWidgetLayout,
  moveWidget,
  saveWidgetLayout,
  type WidgetId,
  type WidgetLayout,
} from '../../../lib/widget-layout';

interface WidgetState extends WidgetLayout {
  editing: boolean;
  setEditing: (editing: boolean) => void;
  hide: (id: WidgetId) => void;
  show: (id: WidgetId) => void;
  move: (fromId: WidgetId, toId: WidgetId) => void;
  reset: () => void;
}

function persist(next: WidgetLayout) {
  void saveWidgetLayout(next);
  return next;
}

/**
 * 위젯 배치 스토어.
 *
 * 화면을 먼저 바꾸고 저장은 뒤따른다(낙관적) — 배치는 되돌리기 쉬운 취향 설정이라
 * 저장 실패로 조작이 막히는 편보다 낫다.
 */
export const useWidgetStore = create<WidgetState>((set) => ({
  ...DEFAULT_LAYOUT,
  editing: false,
  setEditing: (editing) => set({ editing }),
  hide: (id) =>
    set((s) =>
      persist({ order: s.order, hidden: s.hidden.includes(id) ? s.hidden : [...s.hidden, id] }),
    ),
  show: (id) =>
    set((s) => persist({ order: s.order, hidden: s.hidden.filter((x) => x !== id) })),
  move: (fromId, toId) =>
    set((s) => persist({ order: moveWidget(s.order, fromId, toId), hidden: s.hidden })),
  reset: () => set(persist({ ...DEFAULT_LAYOUT })),
}));

// 저장된 배치로 hydrate. 읽기 전에는 기본 배치가 잠깐 보인다.
void getWidgetLayout().then((layout) => useWidgetStore.setState(layout));
