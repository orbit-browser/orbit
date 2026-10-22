import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
  loading?: boolean;
  error?: boolean;
  empty?: boolean;
  emptyText?: string;
  /** 주면 오류 상태에 다시 시도 버튼을 둔다. */
  onRetry?: () => void;
  children: ReactNode;
}

// 로딩/에러/빈/성공 4상태를 일관되게 처리합니다.
export function StatePlaceholder({
  loading,
  error,
  empty,
  emptyText = '표시할 항목이 없습니다',
  onRetry,
  children,
}: Props) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-orbit-muted">
        <Loader2 size={20} className="animate-spin" />
        <p className="text-xs">불러오는 중…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-center text-xs text-orbit-muted" role="alert">
        정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="cursor-pointer rounded-md border border-orbit-border bg-orbit-surface px-2.5 py-1 text-[11px] font-semibold text-orbit-text transition hover:border-orbit-primary-muted hover:text-orbit-primary"
          >
            다시 시도
          </button>
        )}
      </div>
    );
  }
  if (empty) {
    return <div className="py-12 text-center text-xs text-orbit-muted">{emptyText}</div>;
  }
  return <>{children}</>;
}
