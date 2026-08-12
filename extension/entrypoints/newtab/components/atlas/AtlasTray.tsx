import { useEffect, useRef, useState } from 'react';
import { PageFavicon } from './PageFavicon';
import type { PageNode, SessionNode } from './data';
import { formatMinutes } from './data';

const cx = (...classes: (string | false | undefined | null)[]) => classes.filter(Boolean).join(' ');

interface AtlasTrayProps {
  session: SessionNode;
  selectedPageId: string | null;
  onSelectPage: (pageId: string) => void;
  onPrevSession: () => void;
  onNextSession: () => void;
  onClose: () => void;
}

/** 도메인에서 카드 아이콘용 이니셜을 뽑는다. */

export function AtlasTray({
  session,
  selectedPageId,
  onSelectPage,
  onPrevSession,
  onNextSession,
  onClose,
}: AtlasTrayProps) {
  /** 우클릭 메뉴 — 어떤 페이지에 대해 어디에 띄울지 */
  const [menu, setMenu] = useState<{ page: PageNode; x: number; y: number } | null>(null);

  // 바깥 클릭·ESC·스크롤로 닫는다. 메뉴가 화면에 남아 떠다니면 안 된다.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu]);

  const openPage = (page: PageNode, target: 'current' | 'new-tab' | 'new-window') => {
    setMenu(null);
    if (target === 'current') {
      window.location.assign(page.url);
      return;
    }
    if (target === 'new-window') {
      // 확장 API 가 있으면 진짜 새 창, 없으면 팝업 창으로 폴백한다.
      if (typeof chrome !== 'undefined' && chrome.windows?.create) {
        void chrome.windows.create({ url: page.url });
        return;
      }
      window.open(page.url, '_blank', 'noopener,noreferrer,popup');
      return;
    }
    window.open(page.url, '_blank', 'noopener,noreferrer');
  };

  const viewportRef = useRef<HTMLDivElement>(null);
  const maxMinutes = Math.max(...session.pages.map((p) => p.minutes), 1);

  // 다른 세션의 카드를 이전 세션에서 보던 위치부터 보여 주지 않는다.
  useEffect(() => {
    if (viewportRef.current) viewportRef.current.scrollLeft = 0;
  }, [session.id]);

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
        {/* 세션이 바뀌면 카드 묶음만 새로 그린다 — 트레이 자체는 제자리에 남는다. */}
        <div className="atlas-tray__cards" key={session.id}>
          {session.pages.map((page, i) => {
            const isActive = selectedPageId === page.id;
            return (
              <article
                key={page.id}
                className={cx('atlas-card', isActive && 'atlas-card--active')}
                onClick={() => onSelectPage(page.id)}
                onKeyDown={(e) => e.key === 'Enter' && onSelectPage(page.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ page, x: e.clientX, y: e.clientY });
                }}
                role="button"
                tabIndex={0}
                style={{ '--card-hue': session.hue } as React.CSSProperties}
              >
                <div className="atlas-card__top">
                  <PageFavicon url={page.url} domain={page.domain} className="atlas-card__icon" />
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
                  {/* 마우스를 올리면 열기 옵션이 위로 쌓이며 드러난다 */}
                  <div className="atlas-card__open" onClick={(e) => e.stopPropagation()}>
                    <div className="atlas-card__open-stack">
                      <button
                        type="button"
                        className="atlas-card__open-option"
                        onClick={() => openPage(page, 'new-window')}
                      >
                        <i className="ph ph-arrow-square-out"></i>
                        새 창에서 열기
                      </button>
                      <button
                        type="button"
                        className="atlas-card__open-option"
                        onClick={() => openPage(page, 'new-tab')}
                      >
                        <i className="ph ph-arrow-square-out"></i>
                        새 탭에서 열기
                      </button>
                    </div>
                    <button
                      type="button"
                      className="atlas-card__ask"
                      onClick={() => openPage(page, 'current')}
                    >
                      <i className="ph ph-arrow-square-out"></i>
                      열기
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {menu && (
        <div
          className="atlas-page-menu"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="atlas-page-menu__item"
            role="menuitem"
            onClick={() => openPage(menu.page, 'current')}
          >
            열기
          </button>
          <button
            type="button"
            className="atlas-page-menu__item"
            role="menuitem"
            onClick={() => openPage(menu.page, 'new-tab')}
          >
            새 탭에서 열기
          </button>
          <button
            type="button"
            className="atlas-page-menu__item"
            role="menuitem"
            onClick={() => openPage(menu.page, 'new-window')}
          >
            새 창에서 열기
          </button>
        </div>
      )}
    </div>
  );
}
