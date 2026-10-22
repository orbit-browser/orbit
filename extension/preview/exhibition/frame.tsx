/**
 * 현수막이 함께 쓰는 틀 — 크기, 머리글·바닥글, 안전 여백, 브라우저 카드.
 * 단위는 현수막의 mm 다(1px = 1mm). 화면에서는 줄이고, 인쇄에서는 1mm 로 키운다(exhibition.css).
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { faviconFor, SHOT_FOCUS, shotFor, type ExhibitPage } from './content';

export const BANNER = {
  height: 2380,
  /** 안전 여백(mm). 족자 막대·걸이가 가릴 수 있는 테두리. 핵심 문구는 이 안에만 둔다. */
  safe: { top: 50, side: 50, bottom: 80 },
};

/** 950 다섯 장의 진행 표시 — 부스 정면 순서 */
const STEPS = ['USE', 'CHAOS', 'ORBIT', 'TECHNOLOGY', 'TEAM'] as const;

interface BannerFrameProps {
  /** STEPS 안의 자리 — 머리글 번호(01–05)도 여기서 나온다. 벽 순서·바닥글 진행 표시와 같다 */
  step: number;
  label: string;
  children: ReactNode;
}

export function BannerFrame({ step, label, children }: BannerFrameProps) {
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
          <b>{String(step + 1).padStart(2, '0')}</b>
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

/** 크롬 창 한 장 — 탭(파비콘·제목), 주소창(도메인), 페이지 화면. 글자 크기가 카드 폭을 따라간다. */
export function BrowserCard({ page, width, height, className, style }: BrowserCardProps) {
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
      <div className="ex-browser__page">
        <PageShot url={page.url} />
      </div>
    </div>
  );
}

/** 파비콘. 못 구하면 도메인 첫 글자 — 아틀라스 PageFavicon 과 같은 규칙이다. */
export function Favicon({ url, domain }: { url: string; domain: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="ex-fav ex-fav--letter">{domain.replace(/^www\./i, '').charAt(0).toUpperCase()}</span>;
  return <img className="ex-fav" src={faviconFor(url)} alt="" draggable={false} onError={() => setFailed(true)} />;
}

/** 페이지 화면(공개 웹페이지 캡처). 못 찍은 화면은 아틀라스의 회색 칸처럼 페이지 모양만 옅게. */
export function PageShot({ url }: { url: string }) {
  const shot = shotFor(url);
  const focus = SHOT_FOCUS[url];
  // 고른 부분(x, y, 폭)이 카드 폭을 채우게 키운다. 세로 여백(%)도 폭 기준이라 비율 그대로 옮겨진다
  const style: CSSProperties | undefined = focus && {
    width: `${(1000 / focus.w) * 100}%`,
    height: 'auto',
    maxWidth: 'none',
    marginLeft: `${(-focus.x / focus.w) * 100}%`,
    marginTop: `${(-focus.y / focus.w) * 100}%`,
  };
  if (shot) return <img src={shot} alt="" draggable={false} style={style} />;
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
