import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Loader2, Pencil, RotateCw } from 'lucide-react';
import type { Session, TabItem } from '../../../lib/types';
import { hueForSession } from '../../../lib/session-hue';
import { attachVisits } from '../../../lib/session-visits';
import { fetchSessionEvents } from '../../../lib/api';
import { useUIStore } from '../store/ui';
import { useDeleteSession, useRenameSession, useRetrySummary } from '../hooks/useSessions';
import { restoreInNewWindow, restoreInCurrentWindow } from '../../../lib/chrome-bridge';
import { Favicon } from './Favicon';

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 겹쳐 보여줄 대표 파비콘 개수 */
const FAVICON_MAX = 3;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/**
 * 같은 사이트가 여러 번 나오면 한 번만 — 겹친 아이콘이 전부 같은 그림이면 구분에 쓸모가 없다.
 * 새 탭 아틀라스의 SessionFavicons 와 같은 규칙을 따른다.
 */
function distinctByHost(tabs: TabItem[]): TabItem[] {
  const seen = new Set<string>();
  const out: TabItem[] = [];
  for (const tab of tabs) {
    const host = hostOf(tab.url);
    if (seen.has(host)) continue;
    seen.add(host);
    out.push(tab);
    if (out.length === FAVICON_MAX) break;
  }
  return out;
}

function FaviconStack({ tabs }: { tabs: TabItem[] }) {
  const shown = distinctByHost(tabs);
  const rest = tabs.length - shown.length;

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <div className="flex -space-x-1.5">
        {shown.map((tab) => (
          <div
            key={tab.id}
            title={tab.title}
            className="inline-block h-5 w-5 overflow-hidden rounded-full bg-orbit-surface ring-2 ring-orbit-bg"
          >
            <Favicon pageUrl={tab.url} src={tab.favIconUrl} />
          </div>
        ))}
      </div>
      {/* 알약 배지 대신 맨 오른쪽 고정폭 숫자 — 아이콘 개수가 달라도 오른쪽 끝이 반듯하다. */}
      <span className="w-6 text-right text-[10px] tabular-nums text-orbit-muted">
        {rest > 0 ? `+${rest}` : ''}
      </span>
    </div>
  );
}

export function SessionRow({ session }: { session: Session }) {
  const showToast = useUIStore((s) => s.showToast);
  const isPending = useUIStore((s) => s.pendingSessionIds.includes(session.id));
  const { mutate: deleteSession } = useDeleteSession();
  const { mutate: renameSession } = useRenameSession();
  const { mutate: retrySummary, isPending: isRetrying } = useRetrySummary();

  const [expanded, setExpanded] = useState(false);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);

  // 방문 시각은 탭이 아니라 이벤트에만 있다. 펼친 세션만 조회한다.
  // fetchSessionEvents 는 실패를 빈 배열로 흡수하므로 목록이 사라지지 않는다.
  const { data: events = [] } = useQuery({
    queryKey: ['session-events', session.id],
    queryFn: () => fetchSessionEvents(session.id),
    enabled: expanded,
  });

  const isSummarizing = isPending || session.summaryStatus === 'pending';
  const isFailed = !isSummarizing && session.summaryStatus === 'failed';
  const urls = session.tabs.map((tab) => tab.url);
  const hue = hueForSession(session.id);
  const visits = attachVisits(session.tabs, events);

  function commitTitle() {
    const next = editingTitle?.trim();
    setEditingTitle(null);
    if (!next || next === session.title) return;
    renameSession(
      { id: session.id, title: next },
      { onSuccess: () => showToast('세션 이름을 바꿨어요') },
    );
  }

  return (
    <div>
      {/* 행 전체가 펼침 토글이다 — 화살표만 누를 수 있으면 표적이 너무 작다. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setExpanded((open) => !open);
          }
        }}
        className="group flex w-full cursor-pointer select-none items-center gap-2.5 rounded-lg py-2 pl-2 pr-2.5 transition hover:bg-orbit-surface"
      >
        {/*
          세션 색 점 — 같은 세션이 새 탭 궤도에서도 같은 색이다.
          hover·펼침에서는 같은 자리에서 화살표로 바뀐다(자리를 옮기지 않아 목록이 흔들리지 않는다).
        */}
        <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
          <span
            aria-hidden
            // 채도를 배경 쪽으로 눌러 둔다 — 원색 점이 줄줄이 서면 무지개처럼 읽힌다.
            style={{ backgroundColor: `color-mix(in srgb, ${hue} 55%, transparent)` }}
            className={`h-[5px] w-[5px] rounded-full transition-opacity duration-150 ${
              expanded ? 'opacity-0' : 'opacity-100 group-hover:opacity-0'
            }`}
          />
          <ChevronRight
            size={13}
            aria-hidden
            className={`absolute text-orbit-muted transition-all duration-150 ${
              expanded ? 'rotate-90 opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
          />
        </span>

        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {isSummarizing && (
            <Loader2 size={11} className="shrink-0 animate-spin text-orbit-primary" />
          )}
          <h3 className="truncate text-[13px] font-medium text-orbit-text">
            {isSummarizing ? 'AI가 주제 분류 및 요약 중…' : session.title}
          </h3>
        </div>

        {isFailed ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              retrySummary(session.id);
            }}
            disabled={isRetrying}
            className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] font-medium text-orbit-danger transition hover:underline disabled:opacity-50"
          >
            <RotateCw size={10} className={isRetrying ? 'animate-spin' : ''} />
            다시 시도
          </button>
        ) : (
          <FaviconStack tabs={session.tabs} />
        )}
      </div>

      {expanded && (
        // 세션 색 헤어라인이 펼친 영역을 감싼다 — 행이 삽입된 게 아니라 서랍이 열린 것으로 읽힌다.
        <div
          style={{ borderLeftColor: `color-mix(in srgb, ${hue} 40%, transparent)` }}
          className="ml-4 space-y-2 border-l-[1.5px] pb-3 pl-4 pr-2.5 pt-1"
        >
          {/* 접힌 행에서는 제목만 읽히게 두고, 메타는 펼쳤을 때 여기서 보여준다. */}
          <div className="flex items-center gap-1.5">
            <p className="min-w-0 flex-1 truncate text-[11px] text-orbit-muted">
              {session.tabs.length}개 탭 · {session.timeLabel}
            </p>
            <button
              type="button"
              onClick={() => setEditingTitle(session.title)}
              title="이름 바꾸기"
              aria-label="세션 이름 바꾸기"
              className="shrink-0 cursor-pointer rounded p-1 text-orbit-muted transition-colors hover:bg-orbit-surface hover:text-orbit-text"
            >
              <Pencil size={11} />
            </button>
          </div>

          {editingTitle !== null && (
            <input
              autoFocus
              value={editingTitle}
              maxLength={120}
              onChange={(event) => setEditingTitle(event.target.value)}
              onBlur={commitTitle}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitTitle();
                if (event.key === 'Escape') setEditingTitle(null);
              }}
              aria-label="세션 이름"
              className="w-full rounded-md border border-orbit-primary/50 bg-orbit-surface px-2 py-1 text-xs text-orbit-text outline-none"
            />
          )}

          {isFailed ? (
            <p className="text-xs leading-relaxed text-orbit-danger">
              AI 요약 생성에 실패했어요. 다시 시도해 주세요.
            </p>
          ) : (
            session.summary?.overview && (
              <p className="text-xs leading-relaxed text-orbit-muted">{session.summary.overview}</p>
            )
          )}

          {/* 방문 시각순 — 세션이 어떻게 흘렀는지가 순서로 읽힌다. 재방문은 줄을 늘리지 않고 ×N 으로 센다. */}
          <div className="space-y-0.5">
            {visits.map(({ tab, firstVisitAt, visits: count }) => (
              <a
                key={tab.id}
                href={tab.url}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
                className="flex items-center gap-2 rounded-md px-1.5 py-1.5 transition hover:bg-orbit-surface"
              >
                <span className="w-8 shrink-0 text-[10px] tabular-nums text-orbit-muted">
                  {firstVisitAt ? formatTime(firstVisitAt) : ''}
                </span>
                <div className="h-4 w-4 shrink-0 overflow-hidden rounded bg-orbit-surface">
                  <Favicon pageUrl={tab.url} src={tab.favIconUrl} />
                </div>
                <span className="min-w-0 flex-1 truncate text-xs text-orbit-text">{tab.title}</span>
                {count > 1 && (
                  <span
                    title={`${count}번 방문`}
                    className="shrink-0 text-[10px] tabular-nums text-orbit-muted"
                  >
                    ×{count}
                  </span>
                )}
              </a>
            ))}
          </div>

          {/*
            두 열기 버튼은 같은 동작의 두 방식이라 라벨에 목적지를 적어 구분한다. 어느 쪽을
            고를지는 상황에 달렸으므로 둘을 같은 무게로 두고, 삭제만 조용히 남긴다.
            토스트도 버튼과 같은 낱말을 쓴다 — "열기"로 눌렀는데 "복원했어요"가 뜨면 다른 일로 읽힌다.
          */}
          <div className="flex items-center gap-0.5 pt-0.5">
            <button
              type="button"
              onClick={() => {
                void restoreInNewWindow(urls);
                showToast('새 창에서 열었어요');
              }}
              className="cursor-pointer rounded-md px-1.5 py-1 text-[11px] font-semibold text-orbit-primary transition-colors hover:bg-orbit-primary-soft"
            >
              새 창에서 열기
            </button>
            <button
              type="button"
              onClick={() => {
                void restoreInCurrentWindow(urls);
                showToast('현재 창에 열었어요');
              }}
              className="cursor-pointer rounded-md px-1.5 py-1 text-[11px] font-semibold text-orbit-primary transition-colors hover:bg-orbit-primary-soft"
            >
              현재 창에 열기
            </button>
            <button
              type="button"
              onClick={() => {
                if (!window.confirm(`"${session.title}" 세션을 지울까요?`)) return;
                deleteSession(session.id, {
                  onSuccess: () => showToast('세션을 삭제했어요'),
                });
              }}
              className="ml-auto cursor-pointer rounded-md px-1.5 py-1 text-[11px] font-medium text-orbit-muted transition-colors hover:bg-orbit-danger-soft hover:text-orbit-danger"
            >
              삭제
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
