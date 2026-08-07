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

/** 체류시간을 분/초 포맷으로 표시한다 (예: "2분 30초", "45초"). */
function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}초`;
  if (sec === 0) return `${min}분`;
  return `${min}분 ${sec}초`;
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
  /** 생략하면 삭제 버튼을 표시하지 않는다 (세션 상세/검색 결과 재사용 시). */
  onDelete?: () => void;
  /** 검색 결과 등 축약형 표시 — 체류시간을 생략하고 여백을 줄인다. */
  compact?: boolean;
}

export function TimelineItem({ event, badge, onDelete, compact = false }: TimelineItemProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openInNewTab(event.url)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') openInNewTab(event.url);
      }}
      className={
        'group flex items-center gap-2.5 rounded-lg px-2 hover:bg-orbit-bg cursor-pointer select-none ' +
        (compact ? 'py-1.5' : 'py-2')
      }
    >
      <span className="w-9 shrink-0 text-[10px] font-medium tabular-nums text-orbit-muted">
        {formatTime(event.visitedAt)}
      </span>
      <Favicon pageUrl={event.url} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-orbit-text">{event.title || event.url}</p>
        <p className="truncate text-xs text-orbit-muted">
          {event.domain}
          {!compact && event.durationMs > 0 ? ` · ${formatDuration(event.durationMs)}` : ''}
        </p>
      </div>
      {badge && <SessionBadge badge={badge} />}
      {onDelete && (
        <button
          type="button"
          title="삭제"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="shrink-0 rounded-md p-1 text-orbit-muted opacity-0 transition hover:bg-orbit-border/60 hover:text-orbit-danger group-hover:opacity-100 focus:opacity-100 cursor-pointer"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
