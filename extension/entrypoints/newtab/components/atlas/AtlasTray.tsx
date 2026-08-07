import { useRef } from 'react';
import type { OrbitNode, SessionNode } from './data';
import { formatMinutes } from './data';

const cx = (...classes: (string | false | undefined | null)[]) => classes.filter(Boolean).join(' ');

interface AtlasTrayProps {
  orbit: OrbitNode | null;
  session: SessionNode;
  selectedPageId: string | null;
  onSelectPage: (pageId: string) => void;
  onPrevSession: () => void;
  onNextSession: () => void;
  onClose: () => void;
}

/** 도메인에서 카드 아이콘용 이니셜을 뽑는다. */
const initialOf = (domain: string) => domain.replace(/^WWW\./, '').charAt(0).toUpperCase();

export function AtlasTray({
  orbit,
  session,
  selectedPageId,
  onSelectPage,
  onPrevSession,
  onNextSession,
  onClose,
}: AtlasTrayProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const maxMinutes = Math.max(...session.pages.map((p) => p.minutes), 1);

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const el = viewportRef.current;
    if (!el) return;
    // 트랙패드 가로 스와이프는 네이티브 관성에 맡기고, 세로 휠만 가로로 매핑한다.
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    el.scrollLeft += e.deltaY;
  };

  const scrollBy = (dir: -1 | 1) => {
    const el = viewportRef.current;
    if (!el) return;
    const atStart = el.scrollLeft <= 4;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
    if (dir === -1 && atStart) return onPrevSession();
    if (dir === 1 && atEnd) return onNextSession();
    el.scrollBy({ left: dir * 320, behavior: 'smooth' });
  };

  return (
    <div className="atlas-tray">
      <div className="atlas-tray__head">
        <div className="atlas-tray__head-left">
          <span className={cx('atlas-tray__badge', session.status === 'live' && 'atlas-tray__badge--live')}>
            {session.status === 'live' ? '수집 중' : '세션'}
          </span>
          <span className="atlas-tray__title">{session.title}</span>
          <span className="atlas-tray__meta">
            {session.date} · {formatMinutes(session.minutes)} · 페이지 {session.pages.length}개
          </span>
        </div>
        <div className="atlas-tray__nav-btns">
          <button type="button" aria-label="이전" onClick={() => scrollBy(-1)}>
            <i className="ph ph-caret-left"></i>
          </button>
          <button type="button" aria-label="다음" onClick={() => scrollBy(1)}>
            <i className="ph ph-caret-right"></i>
          </button>
          <button type="button" aria-label="트레이 닫기" onClick={onClose}>
            <i className="ph ph-x"></i>
          </button>
        </div>
      </div>

      <div className="atlas-tray__viewport" ref={viewportRef} onWheel={handleWheel}>
        <div className="atlas-tray__cards">
          {session.pages.map((page, i) => {
            const isActive = selectedPageId === page.id;
            return (
              <article
                key={page.id}
                className={cx('atlas-card', isActive && 'atlas-card--active')}
                onClick={() => onSelectPage(page.id)}
                onKeyDown={(e) => e.key === 'Enter' && onSelectPage(page.id)}
                role="button"
                tabIndex={0}
                style={orbit ? ({ '--card-hue': orbit.hue } as React.CSSProperties) : undefined}
              >
                <div className="atlas-card__top">
                  <div className="atlas-card__icon">{initialOf(page.domain)}</div>
                  <div className="atlas-card__heading">
                    <div className="atlas-card__name">{page.title}</div>
                    <div className="atlas-card__domain">{page.domain}</div>
                  </div>
                  <span className="atlas-card__order">{String(i + 1).padStart(2, '0')}</span>
                </div>

                <div className="atlas-card__dwell">
                  <div className="atlas-card__dwell-bar">
                    <span style={{ width: `${Math.round((page.minutes / maxMinutes) * 100)}%` }} />
                  </div>
                  <span className="atlas-card__dwell-label">{page.minutes}분 체류</span>
                </div>

                <div className="atlas-card__foot">
                  {page.visits > 1 ? (
                    <span className="atlas-card__revisit">
                      <i className="ph ph-arrow-counter-clockwise"></i>
                      {page.visits}회 방문
                    </span>
                  ) : (
                    <span className="atlas-card__revisit atlas-card__revisit--muted">
                      <i className="ph ph-eye"></i>
                      1회 방문
                    </span>
                  )}
                  <button type="button" className="atlas-card__ask" onClick={(e) => e.stopPropagation()}>
                    <i className="ph ph-arrow-square-out"></i>
                    열기
                  </button>
                </div>
              </article>
            );
          })}

          <button type="button" className="atlas-card--add">
            <i className="ph ph-plus"></i>
            <span>페이지 추가</span>
          </button>
        </div>
      </div>
    </div>
  );
}
