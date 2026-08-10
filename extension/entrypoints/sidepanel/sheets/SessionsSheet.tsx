import { useMemo, type ReactNode } from 'react';
import { ChevronRight, Loader2, TriangleAlert } from 'lucide-react';
import type { Session } from '../../../lib/types';
import { Favicon } from '../components/Favicon';
import { SessionDetailBody } from '../components/SessionDetailBody';
import { StatePlaceholder } from '../components/StatePlaceholder';
import { ControlRow } from '../components/control/ControlRow';
import { Sheet } from '../components/control/Sheet';
import { useSessions } from '../hooks/useSessions';
import { useUIStore } from '../store/ui';

/** 세션의 대표 아이콘 — 가장 앞 탭의 파비콘. */
function SessionIcon({ session }: { session: Session }) {
  const first = session.tabs[0];
  if (!first) return <span className="h-4 w-4 rounded-full bg-orbit-border" />;
  return <Favicon pageUrl={first.url} src={first.favIconUrl} size={18} />;
}

function SessionListRow({ session, expanded }: { session: Session; expanded: boolean }) {
  const openSession = useUIStore((s) => s.openSession);
  const collapseSession = useUIStore((s) => s.collapseSession);
  const isPending = useUIStore((s) => s.pendingSessionIds.includes(session.id));

  const isSummarizing = isPending || session.summaryStatus === 'pending';
  const isFailed = !isSummarizing && session.summaryStatus === 'failed';

  return (
    <ControlRow
      icon={
        isSummarizing ? (
          <Loader2 size={15} className="animate-spin text-orbit-primary" />
        ) : (
          <SessionIcon session={session} />
        )
      }
      title={isSummarizing ? 'AI가 주제 분류 및 요약 중…' : session.title}
      active
      onClick={() => (expanded ? collapseSession() : openSession(session.id))}
      ariaLabel={`${session.title} ${expanded ? '접기' : '펼치기'}`}
      trailing={
        <>
          {isFailed && <TriangleAlert size={13} className="text-orbit-danger" aria-hidden />}
          <span className="text-[10px] tabular-nums text-orbit-muted">{session.tabs.length}</span>
          <ChevronRight
            size={14}
            aria-hidden
            className={
              'text-orbit-muted/60 transition-transform duration-300 ' +
              (expanded ? 'rotate-90' : '')
            }
          />
        </>
      }
    />
  );
}

/** 최근 순으로 온 목록을 활동 시점 기준 구간으로 나눈다. */
function groupSessions(sessions: Session[]) {
  const now = Date.now();
  const day = 86_400_000;
  const buckets: { label: string; items: Session[] }[] = [
    { label: '오늘', items: [] },
    { label: '지난 7일', items: [] },
    { label: '이전', items: [] },
  ];

  for (const session of sessions) {
    const at = Date.parse(session.updatedAt);
    const age = Number.isNaN(at) ? Number.POSITIVE_INFINITY : now - at;
    if (age < day) buckets[0].items.push(session);
    else if (age < day * 7) buckets[1].items.push(session);
    else buckets[2].items.push(session);
  }

  return buckets.filter((bucket) => bucket.items.length > 0);
}

/** 펼침 상태에서 접히는 부분(다른 세션·구역 제목)을 감싼다. */
function Collapsible({ collapsed, children }: { collapsed: boolean; children: ReactNode }) {
  return (
    <div className="orbit-collapse" data-collapsed={collapsed}>
      <div>{children}</div>
    </div>
  );
}

/**
 * 저장된 세션.
 *
 * 하나를 고르면 시트를 새로 쌓지 않고 **그 자리에서 펼친다**. 다른 세션은 접히므로
 * 고른 행이 자연히 맨 위로 올라오고, 상세는 그 아래로 흘러내린다.
 */
export function SessionsSheet() {
  const { data: sessions, isLoading, isError } = useSessions();
  const isClustering = useUIStore((s) => s.isClustering);
  const expandedId = useUIStore((s) => s.expandedSessionId);
  const groups = useMemo(() => groupSessions(sessions ?? []), [sessions]);

  const expandedExists = !!expandedId && (sessions ?? []).some((s) => s.id === expandedId);

  return (
    <Sheet title="저장된 세션" meta={sessions?.length ? `${sessions.length}개` : undefined}>
      <div className="px-2 pb-4">
        <StatePlaceholder
          loading={isLoading && !isClustering}
          error={isError}
          empty={!isClustering && !sessions?.length}
          emptyText="저장된 세션이 없어요"
        >
          <Collapsible collapsed={expandedExists}>
            {isClustering && (
              <ControlRow
                icon={<Loader2 size={15} className="animate-spin text-orbit-primary" />}
                title="주제 분류 중…"
              />
            )}
          </Collapsible>

          {groups.map((group) => (
            <section key={group.label} className="space-y-0.5">
              <Collapsible collapsed={expandedExists}>
                <h3 className="px-2 pb-0.5 pt-2 text-[11px] font-semibold text-orbit-muted">
                  {group.label}
                </h3>
              </Collapsible>

              {group.items.map((session) => {
                const expanded = session.id === expandedId;
                return (
                  <div key={session.id}>
                    <Collapsible collapsed={expandedExists && !expanded}>
                      <SessionListRow session={session} expanded={expanded} />
                    </Collapsible>
                    <Collapsible collapsed={!expanded}>
                      {expanded ? <SessionDetailBody sessionId={session.id} /> : <div />}
                    </Collapsible>
                  </div>
                );
              })}
            </section>
          ))}
        </StatePlaceholder>
      </div>
    </Sheet>
  );
}
