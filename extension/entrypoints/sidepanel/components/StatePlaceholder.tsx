import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
  loading?: boolean;
  error?: boolean;
  empty?: boolean;
  emptyText?: string;
  children: ReactNode;
}

// 로딩/에러/빈/성공 4상태를 일관되게 처리합니다.
export function StatePlaceholder({
  loading,
  error,
  empty,
  emptyText = '표시할 항목이 없습니다',
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
      <div className="py-12 text-center text-xs text-orbit-muted">
        정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.
      </div>
    );
  }
  if (empty) {
    return <div className="py-12 text-center text-xs text-orbit-muted">{emptyText}</div>;
  }
  return <>{children}</>;
}
