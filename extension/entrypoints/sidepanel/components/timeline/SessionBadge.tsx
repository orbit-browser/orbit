import { useUIStore } from '../../store/ui';
import type { TimelineBadge } from '../../hooks/useTimeline';

// Timeline/세션 상세 타임라인 항목의 상태 배지 — 분류 대기 / 동기화됨(fallback) / 세션 배정.
// 세션 배정 배지를 클릭하면 세션 상세로 이동한다 (docs/IA.md "타임라인 홈").
export function SessionBadge({ badge }: { badge: TimelineBadge }) {
  const openSession = useUIStore((s) => s.openSession);

  if (badge.kind === 'pending') {
    return (
      <span className="inline-flex shrink-0 items-center rounded-full bg-orbit-bg px-2 py-0.5 text-[10px] font-medium text-orbit-muted">
        분류 대기
      </span>
    );
  }

  if (badge.kind === 'synced') {
    return (
      <span className="inline-flex shrink-0 items-center rounded-full bg-orbit-bg px-2 py-0.5 text-[10px] font-medium text-orbit-muted">
        동기화됨
      </span>
    );
  }

  if (badge.kind === 'excluded') {
    return (
      <span
        title="세션 대상에서 제외된 스침 방문이에요"
        className="inline-flex shrink-0 items-center rounded-full bg-orbit-bg px-2 py-0.5 text-[10px] font-medium text-orbit-muted/70"
      >
        제외됨
      </span>
    );
  }

  return (
    <button
      type="button"
      title={badge.title}
      onClick={(e) => {
        e.stopPropagation();
        openSession(badge.sessionId);
      }}
      className="inline-flex max-w-[120px] shrink-0 items-center rounded-full bg-orbit-primary-soft px-2 py-0.5 text-[10px] font-semibold text-orbit-primary transition hover:brightness-95 cursor-pointer"
    >
      <span className="truncate">{badge.title}</span>
    </button>
  );
}
