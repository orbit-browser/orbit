import { Layers } from 'lucide-react';
import { useUIStore } from '../../store/ui';
import type { TimelineBadge } from '../../hooks/useTimeline';

/**
 * 타임라인 항목의 상태 배지.
 *
 * **정상 상태(`동기화됨`)와 `제외됨` 은 그리지 않는다.** 사용자가 취할 행동이 없는데
 * 제목이 쓸 가로 폭만 가져간다 — 상단 상태 카드를 걷어낼 때와 같은 원칙이다.
 * 세션 배지도 이름을 펼치지 않고 아이콘으로 줄인다. 이름은 툴팁, 이동은 클릭.
 */
export function SessionBadge({ badge }: { badge: TimelineBadge }) {
  const openSession = useUIStore((s) => s.openSession);

  if (badge.kind === 'synced' || badge.kind === 'excluded') return null;

  if (badge.kind === 'pending') {
    return (
      <span
        title="아직 서버에 저장되지 않았어요"
        className="inline-flex shrink-0 items-center rounded-full bg-orbit-bg px-2 py-0.5 text-[10px] font-medium text-orbit-muted"
      >
        대기
      </span>
    );
  }

  return (
    <button
      type="button"
      title={`세션: ${badge.title}`}
      aria-label={`${badge.title} 세션 열기`}
      onClick={(e) => {
        e.stopPropagation();
        openSession(badge.sessionId);
      }}
      className="inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full bg-orbit-primary-soft text-orbit-primary transition hover:brightness-95"
    >
      <Layers size={11} />
    </button>
  );
}
