import { Search } from 'lucide-react';

function formatLastSync(iso: string | null): string {
  if (!iso) return '동기화 없음';
  const d = new Date(iso);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay ? time : `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

interface TimelineDateHeaderProps {
  label: string;
  /**
   * 동기화 현황. 맨 위 그룹에만 넘긴다 — 날짜별 값이 아니라 "지금 상태"라서
   * 모든 헤더에 반복하면 잘못된 정보가 된다.
   */
  status?: { pendingCount: number; lastSyncAt: string | null };
  /** 넘기면 필터 열기 버튼을 보여준다(맨 위 그룹 전용). */
  onOpenFilter?: () => void;
}

/**
 * 날짜 구분 헤더. sticky 로 붙어 있어 상태 줄을 겸한다 —
 * 별도 상태 카드를 두지 않고도 미처리·마지막 동기화가 스크롤 내내 보인다.
 */
export function TimelineDateHeader({ label, status, onOpenFilter }: TimelineDateHeaderProps) {
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-orbit-bg px-2 pb-1.5 pt-1">
      <p className="text-xs font-semibold text-orbit-muted">{label}</p>
      <div className="flex shrink-0 items-center gap-1.5 text-[10px] text-orbit-muted">
        {status && (
          <>
            {status.pendingCount > 0 && (
              <span
                className="flex items-center gap-1 font-semibold text-orbit-primary"
                title={`아직 서버에 저장되지 않은 기록 ${status.pendingCount}개`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-orbit-primary" />
                {status.pendingCount}
              </span>
            )}
            <span title="마지막 동기화 시각" className="tabular-nums">
              {formatLastSync(status.lastSyncAt)}
            </span>
          </>
        )}
        {onOpenFilter && (
          <button
            type="button"
            onClick={onOpenFilter}
            title="걸러내기"
            aria-label="기록 걸러내기"
            className="-mr-1 cursor-pointer rounded p-1 text-orbit-muted transition hover:bg-orbit-surface hover:text-orbit-text"
          >
            <Search size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
