import { useEffect, type ReactNode } from 'react';
import { ChevronLeft, X } from 'lucide-react';
import { useUIStore } from '../../store/ui';

interface SheetProps {
  title: string;
  /** 제목 옆 보조 문구 — 개수 등. */
  meta?: string;
  /** 헤더 우측 액션(돋보기, 더보기 등). */
  actions?: ReactNode;
  /** 헤더와 스크롤 영역 사이에 붙는 고정 영역(검색줄 등). */
  toolbar?: ReactNode;
  children: ReactNode;
}

/**
 * 위젯 격자를 덮는 시트 — 흰 패널로 감싼다.
 *
 * 스택의 첫 장이면 `×`(홈으로 닫기), 그 위에 쌓인 장이면 `‹`(한 장 뒤로)를 보여준다 —
 * macOS 에서 Wi-Fi 팝오버를 닫는 것과 그 안에서 되돌아가는 것을 구분하는 것과 같다.
 * 닫기 버튼은 오른쪽 끝에 작게 둔다.
 */
export function Sheet({ title, meta, actions, toolbar, children }: SheetProps) {
  const depth = useUIStore((s) => s.sheets.length);
  const closeSheet = useUIStore((s) => s.closeSheet);
  const isNested = depth > 1;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      // 입력 중 Escape 는 그 입력의 몫이다(검색줄 닫기 등).
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      closeSheet();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closeSheet]);

  return (
    <section
      className="animate-sheet-in absolute inset-1.5 z-10 flex flex-col overflow-hidden rounded-[22px] bg-orbit-surface shadow-orbit-overlay"
      aria-label={title}
    >
      <header className="flex h-12 shrink-0 items-center gap-1.5 px-3">
        {isNested && (
          <button
            type="button"
            onClick={closeSheet}
            aria-label="뒤로"
            title="뒤로"
            className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-orbit-muted transition hover:bg-orbit-tile hover:text-orbit-text"
          >
            <ChevronLeft size={17} />
          </button>
        )}
        <h2 className="min-w-0 flex-1 truncate text-sm font-bold text-orbit-text">{title}</h2>
        {meta && <span className="shrink-0 text-[11px] text-orbit-muted">{meta}</span>}
        {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
        {!isNested && (
          <button
            type="button"
            onClick={closeSheet}
            aria-label="닫기"
            title="닫기"
            className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full bg-orbit-tile text-orbit-muted transition hover:bg-orbit-tile-hover hover:text-orbit-text"
          >
            <X size={13} strokeWidth={2.5} />
          </button>
        )}
      </header>

      {toolbar && <div className="shrink-0 border-b border-orbit-border/40">{toolbar}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}
