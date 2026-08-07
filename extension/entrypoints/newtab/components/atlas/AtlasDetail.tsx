import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { renameSession } from '../../../../lib/api';
import { broadcastSessionChange } from '../../../../lib/session-events';
import { restoreSession, type RestoreTarget } from '../../lib/restore';
import { PageFavicon } from './PageFavicon';
import type { PageNode, SessionNode } from './data';
import { formatMinutes, mostRevisitedPage, representativePage, topDomains } from './data';


interface AtlasDetailProps {
  session: SessionNode | null;
  page: PageNode | null;
  onSelectPage: (pageId: string) => void;
}

interface Stat {
  label: string;
  value: string;
}

export function AtlasDetail({ session, page, onSelectPage }: AtlasDetailProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // 다른 세션으로 옮겨가면 편집 중이던 내용은 버린다.
  useEffect(() => {
    setEditing(false);
    setActionError(null);
  }, [session?.id]);

  useEffect(() => {
    if (editing) titleInputRef.current?.select();
  }, [editing]);

  const startEditing = () => {
    if (!session) return;
    setDraftTitle(session.title);
    setActionError(null);
    setEditing(true);
  };

  const commitTitle = async () => {
    if (!session) return;
    const next = draftTitle.trim();
    setEditing(false);
    if (!next || next === session.title) return;

    try {
      await renameSession(session.id, next);
      void queryClient.invalidateQueries({ queryKey: ['newtab', 'atlas-data'] });
      // 사이드패널이 열려 있으면 그쪽 목록도 함께 갱신된다.
      broadcastSessionChange({ type: 'sessions:changed' });
    } catch (err) {
      console.error('[Orbit] 세션 이름 변경 실패', err);
      setActionError('이름을 바꾸지 못했어요.');
    }
  };

  const openAllTabs = async (target: RestoreTarget) => {
    if (!session) return;
    setActionError(await restoreSession(session, target));
  };

  const level: 'page' | 'session' | 'empty' = page
    ? 'page'
    : session
    ? 'session'
    : 'empty';

  const title = page?.title ?? session?.title ?? 'Orbit Atlas';
  const subtitle =
    level === 'page'
      ? `${page!.domain} · ${page!.minutes}분 체류`
      : level === 'session'
      ? `${session!.date} · ${formatMinutes(session!.minutes)}`
      : '세션을 선택해 주세요';

  const stats: Stat[] =
    level === 'page'
      ? [
          { label: '체류 시간', value: `${page!.minutes}분` },
          { label: '방문 횟수', value: `${page!.visits}회` },
        ]
      : level === 'session'
      ? [
          { label: '페이지', value: `${session!.pages.length}개` },
          { label: '활성 시간', value: formatMinutes(session!.minutes) },
        ]
      : [];

  const insight = (() => {
    if (level === 'page' && session) {
      return page!.visits > 1
        ? `이 페이지를 ${page!.visits}회 다시 열었습니다. 같은 세션 안에서 재방문이 가장 잦은 축에 속해요.`
        : `“${session.title}” 세션에서 한 번 열어본 페이지입니다.`;
    }
    if (level === 'session' && session) {
      const top = mostRevisitedPage(session);
      const domains = topDomains(session, 2).map((d) => d.domain).join(', ');
      if (!top) return '이 세션에는 아직 페이지 탐색 기록이 없습니다.';
      return `${domains || '여러 페이지'} 중심으로 ${formatMinutes(session.minutes)}을 썼고, “${top.title}” 을 총 ${top.visits}회 방문했습니다.`;
    }
    return '왼쪽에서 세션을 고르면 탐색 기록 요약이 여기에 표시됩니다.';
  })();

  return (
    <aside className="atlas-detail">
      <div className="atlas-detail__head">
        <div className="atlas-detail__head-top">
          <span className="atlas-detail__heading">세부 정보</span>
          <div className="atlas-detail__head-actions">
            <button
              type="button"
              aria-label="세션 이름 편집"
              title="세션 이름 편집"
              onClick={startEditing}
              disabled={!session}
            >
              <i className="ph ph-pencil-simple"></i>
            </button>
          </div>
        </div>

        {session && (
          <nav className="atlas-detail__crumbs">
            <span className="atlas-detail__crumb" style={{ color: session.hue }}>
              {(() => {
                const rep = representativePage(session);
                return rep ? (
                  <PageFavicon url={rep.url} domain={rep.domain} className="atlas-detail__crumb-mark" />
                ) : null;
              })()}
              {session.title}
            </span>
            {page && (
              <>
                <i className="ph ph-caret-right"></i>
                <span className="atlas-detail__crumb atlas-detail__crumb--current">{page.domain}</span>
              </>
            )}
          </nav>
        )}

        <div className="atlas-detail__topic">
          <div className="atlas-detail__topic-row">
            <div
              className="atlas-detail__topic-icon"
              style={
                session
                  ? {
                      background: `color-mix(in srgb, ${session.hue} 12%, transparent)`,
                      color: session.hue,
                    }
                  : undefined
              }
            >
              {level === 'page' && page ? (
                <PageFavicon url={page.url} domain={page.domain} className="atlas-detail__topic-mark" />
              ) : session ? (
                (() => {
                  const rep = representativePage(session);
                  return rep ? (
                    <PageFavicon url={rep.url} domain={rep.domain} className="atlas-detail__topic-mark" />
                  ) : (
                    <i className="ph ph-circles-three"></i>
                  );
                })()
              ) : (
                <i className="ph ph-circles-three"></i>
              )}
            </div>
            <div className="atlas-detail__topic-text">
              {editing && session ? (
                <input
                  ref={titleInputRef}
                  className="atlas-detail__title-input"
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  onBlur={() => void commitTitle()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void commitTitle();
                    if (e.key === 'Escape') setEditing(false);
                  }}
                  aria-label="세션 이름"
                />
              ) : (
                <div
                  className="atlas-detail__topic-title"
                  onDoubleClick={startEditing}
                  title={session ? '더블클릭해 이름 변경' : undefined}
                >
                  {title}
                </div>
              )}
              <div className="atlas-detail__topic-sub">{subtitle}</div>
            </div>
          </div>

          {stats.length > 0 && (
            <div className="atlas-detail__stats">
              {stats.map((s) => (
                <div className="atlas-detail__stat" key={s.label}>
                  <div className="atlas-detail__stat-label">{s.label}</div>
                  <div className="atlas-detail__stat-value">{s.value}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="atlas-detail__scroll">
        <section>
          <div className="atlas-detail__section-title atlas-detail__section-title--accent">
            <i className="ph ph-sparkle"></i>
            탐색 인사이트
          </div>
          <div className="atlas-detail__insight">
            <p>{insight}</p>
          </div>
        </section>

        {session && session.summary.overview && (
          <section>
            <div className="atlas-detail__section-title">세션 요약</div>
            <p className="atlas-detail__summary">{session.summary.overview}</p>
            {session.summary.highlights.length > 0 && (
              <ul className="atlas-detail__list">
                {session.summary.highlights.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            )}
          </section>
        )}

        {session && session.summary.nextActions.length > 0 && (
          <section>
            <div className="atlas-detail__section-title">다음 할 일</div>
            <div className="atlas-detail__todos">
              {session.summary.nextActions.map((a) => (
                <label className="atlas-detail__todo" key={a}>
                  <input type="checkbox" />
                  <span>{a}</span>
                </label>
              ))}
            </div>
          </section>
        )}

        {session && (
          <section>
            <div className="atlas-detail__section-title">주요 도메인</div>
            <div className="atlas-detail__tags">
              {topDomains(session, 6).map(({ domain, count }) => (
                <span key={domain} className="atlas-detail__tag">
                  {domain}
                  {count > 1 && <em>{count}</em>}
                </span>
              ))}
            </div>
          </section>
        )}

        {session && !page && mostRevisitedPage(session) && (
          <section>
            <div className="atlas-detail__section-title">가장 많이 본 페이지</div>
            <button
              type="button"
              className="atlas-detail__action"
              onClick={() => {
                const mostVisited = mostRevisitedPage(session);
                if (mostVisited) onSelectPage(mostVisited.id);
              }}
            >
              <span className="atlas-detail__action-left">
                <i className="ph ph-arrow-counter-clockwise"></i>
                {mostRevisitedPage(session)?.title}
              </span>
              <span className="atlas-detail__action-meta">×{mostRevisitedPage(session)?.visits}</span>
            </button>
          </section>
        )}

        <section>
          <div className="atlas-detail__section-title">작업</div>
          {/* 마우스를 올리면 "새 창으로" 가 함께 드러난다 — 기본 동작은 현재 창에 열기 */}
          <div className="atlas-detail__actions atlas-detail__actions--open">
            <button
              type="button"
              className="atlas-detail__action"
              disabled={!session}
              onClick={() => void openAllTabs('current')}
            >
              <span className="atlas-detail__action-left">
                <i className="ph ph-arrow-square-out"></i>
                세션 탭 모두 열기
              </span>
              <i className="ph ph-caret-right"></i>
            </button>
            <button
              type="button"
              className="atlas-detail__action atlas-detail__action--alt"
              disabled={!session}
              onClick={() => void openAllTabs('new-window')}
            >
              <span className="atlas-detail__action-left">
                <i className="ph ph-arrow-square-out"></i>
                새 창으로 모두 열기
              </span>
              <i className="ph ph-caret-right"></i>
            </button>
          </div>
          {actionError && (
            <p className="atlas-detail__action-error" role="alert">
              {actionError}
            </p>
          )}
        </section>
      </div>

    </aside>
  );
}
