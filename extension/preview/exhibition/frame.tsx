/**
 * 세 현수막이 함께 쓰는 틀 — 크기, 머리글·바닥글, 안전 여백, 브라우저 카드.
 * 단위는 현수막의 mm 다(1px = 1mm). 화면에서는 줄이고, 인쇄에서는 1mm 로 키운다(exhibition.css).
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { faviconFor, shotFor, type ExhibitPage } from './content';

export const BANNER = {
  width: 950,
  height: 2380,
  /** 안전 여백(mm). 걸이·틀·받침대가 가릴 수 있는 테두리. 핵심 문구는 이 안에만 둔다. */
  safe: { top: 50, side: 50, bottom: 80 },
};

const CHAPTERS = ['CHAOS', 'ORBIT', 'TECHNOLOGY'] as const;

interface BannerFrameProps {
  /** 0, 1, 2 */
  index: number;
  label: string;
  children: ReactNode;
}

export function BannerFrame({ index, label, children }: BannerFrameProps) {
  return (
    <article className={`ex-banner ex-banner--${index + 1}`} aria-label={label}>
      {children}
      <header className="ex-head">
        <div className="ex-head__brand">
          {/* 제품의 브랜드 마크(public/orbit-mark.png) — 새로 그리지 않았다 */}
          <img src="/orbit-mark.png" alt="" />
          <span>Orbit</span>
        </div>
        <div className="ex-head__chapter">
          <b>{String(index + 1).padStart(2, '0')}</b>
          <span>{CHAPTERS[index]}</span>
        </div>
      </header>
      <footer className="ex-foot">
        <span className="ex-foot__line">FROM CHAOS TO MEMORY</span>
        <ol className="ex-foot__steps">
          {CHAPTERS.map((name, step) => (
            <li key={name} className={step === index ? 'is-on' : undefined}>
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
function SafeGuide() {
  const { top, side, bottom } = BANNER.safe;
  return (
    <div className="ex-safe" aria-hidden style={{ top, left: side, right: side, bottom }}>
      <span>안전 여백 {side}mm · 하단 {bottom}mm</span>
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

/** 크롬 창 한 장 — 탭(파비콘·제목), 주소창(도메인), 페이지 화면. 글자 크기가 카드 폭을 따라간다. */
export function BrowserCard({ page, width, height, className, style }: BrowserCardProps) {
  const shot = shotFor(page.url);
  return (
    <div className={`ex-browser${className ? ` ${className}` : ''}`} style={{ width, height, fontSize: width / 30, ...style }}>
      <div className="ex-browser__tabs">
        <span className="ex-browser__tab">
          <Favicon url={page.url} domain={page.domain} />
          <span>{page.title}</span>
        </span>
      </div>
      <div className="ex-browser__toolbar">
        <span className="ex-browser__nav" />
        <span className="ex-browser__omni">{page.domain}</span>
      </div>
      <div className="ex-browser__page">{shot ? <img src={shot} alt="" /> : <PagePlaceholder />}</div>
    </div>
  );
}

/** 파비콘. 못 구하면 도메인 첫 글자 — 아틀라스 PageFavicon 과 같은 규칙이다. */
export function Favicon({ url, domain }: { url: string; domain: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="ex-fav ex-fav--letter">{domain.replace(/^www\./i, '').charAt(0).toUpperCase()}</span>;
  return <img className="ex-fav" src={faviconFor(url)} alt="" draggable={false} onError={() => setFailed(true)} />;
}

/** 화면을 못 찍은(또는 끈) 페이지 — 아틀라스의 회색 칸처럼, 페이지 모양만 옅게. */
export function PagePlaceholder() {
  return (
    <div className="ex-placeholder" aria-hidden>
      <i style={{ width: '38%' }} />
      <i style={{ width: '82%', height: '14%' }} />
      <i style={{ width: '64%' }} />
      <i style={{ width: '72%' }} />
      <i style={{ width: '46%' }} />
    </div>
  );
}
