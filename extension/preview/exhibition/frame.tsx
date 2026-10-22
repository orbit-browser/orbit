/**
 * 현수막이 함께 쓰는 틀 — 크기, 머리글·바닥글, 안전 여백, 브라우저 카드.
 * 단위는 현수막의 mm 다(1px = 1mm). 화면에서는 줄이고, 인쇄에서는 1mm 로 키운다(exhibition.css).
 */
import type { CSSProperties, ReactNode } from 'react';
import type { ExhibitPage } from './content';
import { siteOf } from './content';
import { DemoPageView, SiteMark } from './pages';

export const BANNER = {
  height: 2380,
  /** 안전 여백(mm). 족자 막대·걸이가 가릴 수 있는 테두리. 핵심 문구는 이 안에만 둔다. */
  safe: { top: 50, side: 50, bottom: 80 },
};

/** 950 다섯 장의 진행 표시 — 부스 정면 순서 */
const STEPS = ['USE', 'CHAOS', 'ORBIT', 'TECHNOLOGY', 'TEAM'] as const;

interface BannerFrameProps {
  /** STEPS 안의 자리 */
  step: number;
  /** 머리글 오른쪽 장 번호(가운데 벽 세 장만) */
  number?: string;
  label: string;
  children: ReactNode;
}

export function BannerFrame({ step, number, label, children }: BannerFrameProps) {
  return (
    <article className={`ex-banner ex-banner--${STEPS[step].toLowerCase()}`} aria-label={label}>
      {children}
      <header className="ex-head">
        <div className="ex-head__brand">
          {/* 제품의 브랜드 마크(public/orbit-mark.png) — 새로 그리지 않았다 */}
          <img src="/orbit-mark.png" alt="" />
          <span>Orbit</span>
        </div>
        <div className="ex-head__chapter">
          {number && <b>{number}</b>}
          <span>{STEPS[step]}</span>
        </div>
      </header>
      <footer className="ex-foot">
        <span className="ex-foot__line">FROM CHAOS TO MEMORY</span>
        <ol className="ex-foot__steps">
          {STEPS.map((name, index) => (
            <li key={name} className={index === step ? 'is-on' : undefined}>
              <i />
              {name}
            </li>
          ))}
        </ol>
      </footer>
      <SafeGuide />
    </article>
  );
}

/** 안전 여백 안내선 — 보기 옵션으로만 보이고 인쇄에는 나오지 않는다. */
export function SafeGuide() {
  const { top, side, bottom } = BANNER.safe;
  return (
    <div className="ex-safe" aria-hidden style={{ top, left: side, right: side, bottom }}>
      <span>
        안전 여백 {side}mm · 위 {top}mm · 아래 {bottom}mm
      </span>
    </div>
  );
}

interface BrowserCardProps {
  page: ExhibitPage;
  width: number;
  height: number;
  className?: string;
  style?: CSSProperties;
}

/** 브라우저 창 한 장 — 탭(사이트 표시·제목), 주소창(도메인), 가상 페이지. 글자 크기가 카드 폭을 따라간다. */
export function BrowserCard({ page, width, height, className, style }: BrowserCardProps) {
  const site = siteOf(page);
  return (
    <div className={`ex-browser${className ? ` ${className}` : ''}`} style={{ width, height, fontSize: width / 30, ...style }}>
      <div className="ex-browser__tabs">
        <span className="ex-browser__tab">
          <SiteMark site={site} />
          <span>{page.title}</span>
        </span>
      </div>
      <div className="ex-browser__toolbar">
        <span className="ex-browser__nav" />
        <span className="ex-browser__omni">{page.domain}</span>
      </div>
      <div className="ex-browser__page">
        <DemoPageView page={page} width={width} />
      </div>
    </div>
  );
}
