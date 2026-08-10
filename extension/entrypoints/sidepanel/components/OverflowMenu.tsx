import { useEffect, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';

export interface MenuAction {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

export function OverflowMenu({ actions }: { actions: MenuAction[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        title="더보기"
        className="p-1 rounded-md text-orbit-muted hover:bg-orbit-tile hover:text-orbit-text"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 min-w-28 rounded-lg border border-orbit-border bg-orbit-surface py-1 shadow-orbit-overlay">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              className={
                'block w-full px-3 py-1.5 text-left text-xs hover:bg-orbit-tile ' +
                (a.danger ? 'text-orbit-danger' : 'text-orbit-text')
              }
              onClick={(e) => {
                e.stopPropagation();
                a.onClick();
                setOpen(false);
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
