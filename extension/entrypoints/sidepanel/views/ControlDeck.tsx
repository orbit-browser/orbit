import { useState } from 'react';
import { Check, Plus, SlidersHorizontal } from 'lucide-react';
import type { WidgetId } from '../../../lib/widget-layout';
import { WIDGET_REGISTRY } from '../components/widgets/registry';
import { WidgetFrame } from '../components/widgets/WidgetFrame';
import { useMergeSuggestions } from '../hooks/useMergeSuggestions';
import { usePendingSessionPoller } from '../hooks/useSessions';
import { useWidgetStore } from '../store/widgets';

/** 편집 모드에서 다시 추가할 수 있는 위젯 목록. */
function AddableWidgets({ hidden, onAdd }: { hidden: WidgetId[]; onAdd: (id: WidgetId) => void }) {
  if (hidden.length === 0) {
    return (
      <p className="px-1 pt-1 text-center text-[11px] text-orbit-muted/70">
        모든 위젯을 사용하고 있어요
      </p>
    );
  }

  return (
    <div className="space-y-1.5 pt-1">
      <p className="px-1 text-[11px] font-bold text-orbit-muted">추가할 수 있는 위젯</p>
      {hidden.map((id) => {
        const widget = WIDGET_REGISTRY[id];
        return (
          <button
            key={id}
            type="button"
            onClick={() => onAdd(id)}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-[20px] border border-dashed border-orbit-border bg-orbit-surface/60 px-3 py-2.5 text-left transition hover:border-orbit-primary/50 hover:bg-orbit-surface"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-orbit-primary-soft text-orbit-primary">
              <Plus size={14} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-bold text-orbit-text">
                {widget.label}
              </span>
              <span className="block truncate text-[10px] text-orbit-muted">{widget.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * 사이드패널 홈 — macOS 제어 센터식 4열 위젯 격자.
 *
 * 위젯은 1×1(원형 아이콘) · 2×1(알약) · 4×1(스트립) 세 크기를 쓴다.
 * 순서와 표시 여부는 사용자가 편집하고 `chrome.storage.local` 에 남는다.
 */
export function ControlDeck() {
  usePendingSessionPoller();

  const order = useWidgetStore((s) => s.order);
  const hiddenList = useWidgetStore((s) => s.hidden);
  const editing = useWidgetStore((s) => s.editing);
  const setEditing = useWidgetStore((s) => s.setEditing);
  const hide = useWidgetStore((s) => s.hide);
  const show = useWidgetStore((s) => s.show);
  const move = useWidgetStore((s) => s.move);
  const [dragId, setDragId] = useState<WidgetId | null>(null);

  // 병합 제안이 없으면 격자에서 아예 뺀다. 편집 중에는 자리를 보여줘야 배치를 바꿀 수 있다.
  const { data: mergeSuggestions } = useMergeSuggestions();
  const hasMergeSuggestions = (mergeSuggestions?.length ?? 0) > 0;

  const hidden = new Set(hiddenList);
  const visible = order.filter(
    (id) => !hidden.has(id) && (id !== 'merge' || editing || hasMergeSuggestions),
  );

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3 pb-4">
      <div className="animate-tile-in grid grid-cols-4 gap-2 [grid-auto-rows:58px]">
        {visible.map((id) => {
          const widget = WIDGET_REGISTRY[id];
          const { Component } = widget;
          return (
            <WidgetFrame
              key={id}
              id={id}
              size={widget.size}
              label={widget.label}
              editing={editing}
              dragging={dragId === id}
              onRemove={() => hide(id)}
              onDragStart={() => setDragId(id)}
              onDragEnter={() => {
                if (dragId && dragId !== id) move(dragId, id);
              }}
              onDragEnd={() => setDragId(null)}
            >
              <Component />
            </WidgetFrame>
          );
        })}
      </div>

      {editing && <AddableWidgets hidden={order.filter((id) => hidden.has(id))} onAdd={show} />}

      <div className="flex justify-center pt-3">
        <button
          type="button"
          onClick={() => setEditing(!editing)}
          className={
            'flex cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] font-bold transition ' +
            (editing
              ? 'bg-orbit-primary text-white shadow-orbit-raised'
              : 'border border-orbit-border bg-orbit-surface text-orbit-muted hover:text-orbit-text')
          }
        >
          {editing ? <Check size={12} /> : <SlidersHorizontal size={12} />}
          {editing ? '완료' : '위젯 편집'}
        </button>
      </div>
    </div>
  );
}
