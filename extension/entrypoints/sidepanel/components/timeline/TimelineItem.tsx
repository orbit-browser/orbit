import { X } from 'lucide-react';
import { Favicon } from '../Favicon';
import { SessionBadge } from './SessionBadge';
import type { TimelineBadge } from '../../hooks/useTimeline';

export interface TimelineEventLike {
  id: string;
  url: string;
  title: string;
  domain: string;
  /** ISO 8601 */
  visitedAt: string;
  durationMs: number;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 한 줄에 얹을 체류시간 — 분 단위 위로는 초를 버린다.
 *
 * 목록에서 이 값이 하는 일은 "스쳤나 읽었나"를 가르는 것뿐이라 초 단위 정밀도가 필요 없고,
 * 우측 예산을 배지와 나눠 써야 해서 짧을수록 좋다.
 */
function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  if (totalSec < 60) return `${totalSec}초`;
  const totalMin = Math.round(totalSec / 60);
  if (totalMin < 60) return `${totalMin}분`;
  return `${Math.round(totalMin / 60)}시간`;
}

function openInNewTab(url: string): void {
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    chrome.tabs.create({ url });
    return;
  }
  window.open(url, '_blank', 'noopener');
}

interface TimelineItemProps {
  event: TimelineEventLike;
  /** 생략하면 배지를 표시하지 않는다 (세션 상세 탐색 타임라인 재사용 시). */
  badge?: TimelineBadge;
  /** 생략하면 삭제 버튼을 표시하지 않는다 (세션 상세 재사용 시). */
  onDelete?: () => void;
}

/**
 * 방문 기록 한 줄.
 *
 * 도메인은 표시하지 않는다 — 파비콘이 같은 정보를 더 빨리 전달하고, 사이트 이름은 제목에
 * 다시 나오는 경우가 많다. 대신 줄을 하나로 줄여 한 화면에 보이는 기록 수를 늘렸다.
 * 파비콘을 못 그린 행(중립 아이콘)에서는 hover 툴팁의 URL 이 유일한 단서가 된다.
 */
export function TimelineItem({ event, badge, onDelete }: TimelineItemProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      title={event.title ? `${event.title}\n${event.url}` : event.url}
      onClick={() => openInNewTab(event.url)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') openInNewTab(event.url);
      }}
      className="group flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-orbit-bg"
    >
      <span className="w-9 shrink-0 text-[10px] font-medium tabular-nums text-orbit-muted">
        {formatTime(event.visitedAt)}
      </span>
      <Favicon pageUrl={event.url} />
      <p className="min-w-0 flex-1 truncate text-sm text-orbit-text">
        {event.title || event.url}
      </p>
      {badge && <SessionBadge badge={badge} />}
      {/* 체류시간을 맨 오른쪽 고정폭에 두면 배지 유무와 무관하게 숫자가 한 열로 선다. */}
      <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-orbit-muted">
        {event.durationMs > 0 ? formatDuration(event.durationMs) : ''}
      </span>
      {onDelete && (
        <button
          type="button"
          title="삭제"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          // 평소에는 폭도 간격도 0이라 오른쪽에 빈자리를 남기지 않는다.
          // 음수 마진이 flex gap 을 상쇄하고, hover 에서만 자리를 만들며 펼쳐진다.
          className="-ml-2.5 w-0 shrink-0 cursor-pointer overflow-hidden rounded-md text-orbit-muted opacity-0 transition-all duration-150 group-hover:ml-0 group-hover:w-6 group-hover:opacity-100 focus:ml-0 focus:w-6 focus:opacity-100"
        >
          <span className="flex h-6 w-6 items-center justify-center transition hover:bg-orbit-border/60 hover:text-orbit-danger rounded-md">
            <X size={14} />
          </span>
        </button>
      )}
    </div>
  );
}
