import type { ReactNode } from 'react';

/**
 * 시트 안의 목록 한 줄 — macOS Wi-Fi 팝오버의 네트워크 행과 같은 구성이다.
 *
 * 원형 디스크 + 이름 한 줄 + 오른쪽 보조 표시. 주소나 부가 설명은 담지 않는다.
 * 목록은 훑어보는 곳이고, 자세한 내용은 눌러서 들어간 뒤에 본다.
 */
export function ControlRow({
  icon,
  title,
  active = false,
  trailing,
  onClick,
  onContextMenu,
  ariaLabel,
}: {
  icon: ReactNode;
  title: string;
  /** 켜짐·선택됨 — 디스크가 흰 원 + 액센트가 된다. */
  active?: boolean;
  trailing?: ReactNode;
  onClick?: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  ariaLabel?: string;
}) {
  const content = (
    <>
      <span
        className={
          'flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full transition-colors ' +
          (active ? 'bg-orbit-surface shadow-2xs' : 'bg-orbit-disc-off/70')
        }
      >
        {icon}
      </span>
      <span
        className={
          'min-w-0 flex-1 truncate text-left text-[13px] ' +
          (active ? 'font-bold text-orbit-text' : 'font-medium text-orbit-text')
        }
      >
        {title}
      </span>
      {trailing && <span className="flex shrink-0 items-center gap-1">{trailing}</span>}
    </>
  );

  const shape = 'flex w-full items-center gap-2.5 rounded-[14px] px-2 py-1.5 transition';

  if (!onClick) {
    return (
      <div className={shape} aria-label={ariaLabel}>
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      aria-label={ariaLabel ?? title}
      title={title}
      className={`${shape} cursor-pointer hover:bg-orbit-tile active:scale-[0.99]`}
    >
      {content}
    </button>
  );
}

/** 목록 묶음 — macOS 의 "알고 있는 네트워크" 같은 구역 제목을 얹는다. */
export function ControlSection({
  label,
  trailing,
  children,
}: {
  label: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-0.5">
      <div className="flex items-center justify-between gap-2 px-2 pb-0.5 pt-2">
        <h3 className="text-[11px] font-semibold text-orbit-muted">{label}</h3>
        {trailing}
      </div>
      {children}
    </section>
  );
}
