import type { ReactNode } from 'react';
import { ChevronRight, Minus } from 'lucide-react';
import type { WidgetId } from '../../../../lib/widget-layout';

/** `wide` 2×1 알약 · `small` 1×1 원형 · `full` 4×1 스트립 — macOS 제어 센터의 세 형태다. */
export type WidgetSize = 'wide' | 'small' | 'full';

const SIZE_CLASS: Record<WidgetSize, string> = {
  wide: 'col-span-2 row-span-1',
  small: 'col-span-1 row-span-1',
  full: 'col-span-4 row-span-1',
};

interface WidgetFrameProps {
  id: WidgetId;
  size: WidgetSize;
  label: string;
  editing: boolean;
  onRemove: () => void;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
  dragging: boolean;
  children: ReactNode;
}

/**
 * 위젯 껍데기 — 격자 점유, 편집 모드의 `−` 배지와 드래그 재배치를 맡는다.
 *
 * 자를 것이 없도록 `overflow` 를 걸지 않는다. 타일에 테두리를 두지 않고
 * 배경색과 그림자로만 구분하므로 모서리가 잘려 보이지 않는다.
 */
export function WidgetFrame({
  size,
  label,
  editing,
  onRemove,
  onDragStart,
  onDragEnter,
  onDragEnd,
  dragging,
  children,
}: WidgetFrameProps) {
  return (
    <div
      draggable={editing}
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDragEnd={onDragEnd}
      onDrop={(event) => event.preventDefault()}
      className={
        `relative min-w-0 ${SIZE_CLASS[size]} ` +
        (editing ? 'animate-widget-wiggle cursor-grab active:cursor-grabbing ' : '') +
        (dragging ? 'opacity-40 ' : '')
      }
    >
      <div className={`h-full w-full ${editing ? 'pointer-events-none' : ''}`}>{children}</div>

      {editing && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`${label} 위젯 숨기기`}
          title={`${label} 숨기기`}
          className="absolute -left-1 -top-1 z-10 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-orbit-surface text-orbit-muted shadow-orbit-raised transition hover:text-orbit-danger"
        >
          <Minus size={12} strokeWidth={3} />
        </button>
      )}
    </div>
  );
}

/**
 * 아이콘 디스크.
 *
 * 켜짐 = 흰 원 + 액센트 글리프, 꺼짐 = 회색 원 + 회색 글리프.
 * macOS 의 Wi-Fi·Bluetooth 타일과 같은 규칙이라 토글 스위치가 따로 필요 없다.
 */
export function WidgetDisc({
  icon,
  active,
  size = 32,
}: {
  icon: ReactNode;
  active: boolean;
  size?: number;
}) {
  return (
    <span
      style={{ width: size, height: size }}
      className={
        'flex shrink-0 items-center justify-center rounded-full transition-colors duration-200 ' +
        (active
          ? 'bg-orbit-surface text-orbit-primary shadow-2xs'
          : 'bg-orbit-disc-off text-orbit-muted/80')
      }
    >
      {icon}
    </span>
  );
}

const TILE_BASE =
  'w-full h-full bg-orbit-tile shadow-orbit-raised transition-all duration-200 select-none';

/**
 * 2×1 알약 타일 — 아이콘 디스크 왼쪽, 제목과 짧은 상태가 오른쪽.
 * 곁가지 정보는 담지 않는다. 자세한 내용은 눌러서 여는 시트의 몫이다.
 */
export function WidgetTile({
  icon,
  title,
  status,
  active,
  expandable = false,
  onClick,
  ariaLabel,
  disabled = false,
}: {
  icon: ReactNode;
  title: string;
  status: string;
  active: boolean;
  expandable?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const interactive = !!onClick && !disabled;

  const inner = (
    <>
      <WidgetDisc icon={icon} active={active} />
      <span className="min-w-0 flex-1 text-left">
        <span
          className={
            'block truncate text-[12px] font-bold leading-tight ' +
            (active ? 'text-orbit-text' : 'text-orbit-muted')
          }
        >
          {title}
        </span>
        <span className="mt-0.5 block truncate text-[11px] leading-tight text-orbit-muted">
          {status}
        </span>
      </span>
      {expandable && (
        <ChevronRight size={14} className="shrink-0 text-orbit-muted/60" aria-hidden />
      )}
    </>
  );

  const shape = 'flex items-center gap-2 rounded-[26px] px-2.5';

  if (!interactive) {
    return (
      <div
        aria-label={ariaLabel}
        className={`${TILE_BASE} ${shape} ${disabled ? 'opacity-60' : ''}`}
      >
        {inner}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? title}
      className={`${TILE_BASE} ${shape} cursor-pointer hover:bg-orbit-tile-hover active:scale-[0.98]`}
    >
      {inner}
    </button>
  );
}

/** 1×1 원형 타일 — 아이콘 하나만 담는다. */
export function WidgetCircle({
  icon,
  label,
  active,
  badge,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={
        `${TILE_BASE} relative flex aspect-square items-center justify-center rounded-full ` +
        'cursor-pointer hover:bg-orbit-tile-hover active:scale-95 ' +
        (active ? 'text-orbit-primary' : 'text-orbit-muted/80')
      }
    >
      {icon}
      {badge !== undefined && badge > 0 && (
        <span className="absolute right-1 top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-orbit-primary px-1 text-[9px] font-bold text-white">
          {badge}
        </span>
      )}
    </button>
  );
}

/** 4×1 스트립 타일 — 제목 한 줄과 시각화를 담는다. */
export function WidgetStrip({
  children,
  onClick,
  ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  ariaLabel: string;
}) {
  const shape = 'flex flex-col justify-center gap-1 rounded-[26px] px-3.5';
  if (!onClick) {
    return (
      <div aria-label={ariaLabel} className={`${TILE_BASE} ${shape}`}>
        {children}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`${TILE_BASE} ${shape} cursor-pointer hover:bg-orbit-tile-hover active:scale-[0.99]`}
    >
      {children}
    </button>
  );
}
