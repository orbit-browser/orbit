import { memo } from 'react';
import { hueForSession } from '../../../../lib/session-hue';

/**
 * 탭 미리보기 그림.
 *
 * 아직 탭 화면을 캡처해 모으지 않으므로(권한·저장 방식 결정 전) 주소로 사이트 종류를
 * 짐작해 페이지 윤곽을 그린다. 캡처를 모으게 되면 이 컴포넌트가 그 이미지를 그리면 된다.
 * 윤곽은 320×200 가상 화면에 그린 뒤 카드 크기로 줄인다 — 작은 글자까지 실제 탭
 * 썸네일처럼 보이게.
 */

type PreviewKind = 'docs' | 'repo' | 'forum' | 'article' | 'video' | 'shop' | 'travel' | 'portal' | 'gallery' | 'mail';

const KIND_RULES: [RegExp, PreviewKind][] = [
  [/(^|\.)github\.com$/, 'repo'],
  [/(^|\.)youtube\.com$/, 'video'],
  [/^mail\./, 'mail'],
  [/stackoverflow|quasarzone|reddit|clien/, 'forum'],
  [/dribbble|behance|figma|pinterest|material\.io|phosphoricons/, 'gallery'],
  [/flight|carmore|yanolja|tabelog|mangoplate|airbnb|booking|agoda|trip/, 'travel'],
  [/danawa|compuzone|nike|musinsa|apple\.com|coupang|11st|gmarket|amazon/, 'shop'],
  [/^docs\.|^developer\.|tiangolo|sqlalchemy|qdrant|react\.dev|tanstack|platform\.openai|promptingguide|readthedocs/, 'docs'],
  [/^(www\.)?(naver|google|daum)\.(com|net)$/, 'portal'],
];

/** 가상 화면의 폭. 카드는 이 화면을 줄여서 보여 준다. */
export const PREVIEW_WIDTH = 320;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
};

const kindOf = (host: string): PreviewKind =>
  KIND_RULES.find(([pattern]) => pattern.test(host))?.[1] ?? 'article';

/** 주소마다 같은 모양이 나오도록 만든 작은 난수열 — 줄 길이를 페이지마다 다르게 한다. */
function widths(seed: string, count: number, min = 42, max = 96): number[] {
  let value = [...seed].reduce((hash, char) => (hash * 33 + char.charCodeAt(0)) >>> 0, 5381);
  return Array.from({ length: count }, () => {
    value = (value * 1103515245 + 12345) >>> 0;
    return min + ((value >>> 8) % (max - min + 1));
  });
}

function Lines({ seed, count, className }: { seed: string; count: number; className?: string }) {
  return (
    <span className={`pp-lines${className ? ` ${className}` : ''}`}>
      {widths(seed, count).map((width, index) => (
        <i key={index} style={{ width: `${width}%` }} />
      ))}
    </span>
  );
}

function Header({ name, tone }: { name: string; tone: 'hue' | 'light' | 'dark' }) {
  return (
    <span className={`pp-bar pp-bar--${tone}`}>
      <i className="pp-logo" />
      <b>{name}</b>
      <span className="pp-bar__nav">
        <i />
        <i />
        <i />
      </span>
      <span className="pp-search" />
    </span>
  );
}

function Sketch({ kind, url, host, title }: { kind: PreviewKind; url: string; host: string; title: string }) {
  const name = host.replace(/^www\./, '');
  switch (kind) {
    case 'docs':
      return (
        <>
          <Header name={name} tone="hue" />
          <span className="pp-docs">
            <Lines seed={`${url}side`} count={10} className="pp-side" />
            <span className="pp-main">
              <span className="pp-crumb" />
              <b className="pp-h1">{title}</b>
              <Lines seed={`${url}a`} count={3} />
              <Lines seed={`${url}code`} count={4} className="pp-code" />
              <span className="pp-note"><Lines seed={`${url}n`} count={2} /></span>
              <Lines seed={`${url}b`} count={2} />
            </span>
          </span>
        </>
      );
    case 'repo': {
      const [owner = name, repo = ''] = (() => {
        try {
          return new URL(url).pathname.split('/').filter(Boolean);
        } catch {
          return [];
        }
      })();
      return (
        <>
          <Header name="" tone="dark" />
          <span className="pp-repo">
            <b className="pp-repo__path">
              <i />
              {owner}
              {repo && <> / <strong>{repo}</strong></>}
              <em>Public</em>
            </b>
            <span className="pp-tabs"><i className="on" /><i /><i /><i /></span>
            <span className="pp-files">
              {widths(url, 6, 30, 70).map((width, index) => (
                <span key={index} className="pp-file">
                  <i className={index < 2 ? 'dir' : ''} />
                  <i style={{ width: `${width * 0.5}%` }} />
                  <i style={{ width: `${width * 0.6}%` }} />
                </span>
              ))}
            </span>
            <span className="pp-readme"><b>README.md</b><Lines seed={`${url}r`} count={2} /></span>
          </span>
        </>
      );
    }
    case 'forum':
      return (
        <>
          <Header name={name} tone="light" />
          <span className="pp-forum">
            <b className="pp-h1">{title}</b>
            <span className="pp-meta"><i /><i /><i /></span>
            <span className="pp-post">
              <span className="pp-votes"><i /><b>{12 + (widths(url, 1)[0] % 80)}</b><i /></span>
              <span className="pp-post__body">
                <Lines seed={`${url}q`} count={3} />
                <span className="pp-tags"><i /><i /><i /></span>
              </span>
            </span>
            <span className="pp-post pp-post--answer">
              <span className="pp-votes"><b>{3 + (widths(url, 2)[1] % 30)}</b><i className="ok" /></span>
              <span className="pp-post__body">
                <Lines seed={`${url}ans`} count={2} />
                <Lines seed={`${url}ac`} count={2} className="pp-code" />
              </span>
            </span>
          </span>
        </>
      );
    case 'video':
      return (
        <>
          <Header name="" tone="light" />
          <span className="pp-video">
            <span className="pp-video__main">
              <span className="pp-player"><i className="pp-play" /><i className="pp-progress" /></span>
              <b className="pp-h1">{title}</b>
              <span className="pp-author"><i /><Lines seed={`${url}ch`} count={1} /></span>
            </span>
            <span className="pp-video__side">
              {[0, 1, 2, 3].map((index) => (
                <span key={index} className="pp-rec">
                  <i style={{ filter: `hue-rotate(${index * 47}deg)` }} />
                  <Lines seed={`${url}rec${index}`} count={2} />
                </span>
              ))}
            </span>
          </span>
        </>
      );
    case 'shop':
      return (
        <>
          <Header name={name} tone="light" />
          <span className="pp-shop">
            <b className="pp-h1">{title}</b>
            <span className="pp-grid">
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <span key={index} className="pp-item">
                  <i style={{ filter: `hue-rotate(${index * 23}deg)` }} />
                  <Lines seed={`${url}it${index}`} count={1} />
                  <b />
                </span>
              ))}
            </span>
          </span>
        </>
      );
    case 'travel':
      return (
        <>
          <Header name={name} tone="hue" />
          <span className="pp-travel">
            <span className="pp-banner">
              <b className="pp-h1">{title}</b>
              <span className="pp-form"><i /><i /><i /><b /></span>
            </span>
            <span className="pp-offers">
              {[0, 1, 2].map((index) => (
                <span key={index} className="pp-offer">
                  <i style={{ filter: `hue-rotate(${index * 35 - 20}deg)` }} />
                  <Lines seed={`${url}of${index}`} count={2} />
                  <b />
                </span>
              ))}
            </span>
          </span>
        </>
      );
    case 'portal':
      return (
        <span className="pp-portal">
          <b className="pp-portal__logo">{name.split('.')[0].toUpperCase()}</b>
          <span className="pp-portal__search"><i /></span>
          <span className="pp-portal__tiles">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => <i key={index} />)}
          </span>
          <Lines seed={`${url}news`} count={3} />
        </span>
      );
    case 'mail':
      return (
        <>
          <Header name={name} tone="light" />
          <span className="pp-mail">
            <span className="pp-mail__side"><b /><Lines seed={`${url}m`} count={6} /></span>
            <span className="pp-mail__list">
              {widths(url, 8, 40, 90).map((width, index) => (
                <span key={index} className={index < 3 ? 'unread' : ''}>
                  <i />
                  <i style={{ width: `${width * 0.35}%` }} />
                  <i style={{ width: `${width * 0.55}%` }} />
                </span>
              ))}
            </span>
          </span>
        </>
      );
    case 'gallery':
      return (
        <>
          <Header name={name} tone="light" />
          <span className="pp-gallery">
            <b className="pp-h1">{title}</b>
            <span className="pp-shots">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
                <i key={index} style={{ filter: `hue-rotate(${index * 41}deg) saturate(${0.7 + (index % 3) * 0.2})` }} />
              ))}
            </span>
          </span>
        </>
      );
    default:
      return (
        <>
          <Header name={name} tone="light" />
          <span className="pp-article">
            <span className="pp-kicker" />
            <b className="pp-h1">{title}</b>
            <span className="pp-author"><i /><Lines seed={`${url}by`} count={1} /></span>
            <span className="pp-hero" />
            <Lines seed={`${url}p`} count={4} />
          </span>
        </>
      );
  }
}

interface PagePreviewProps {
  url: string;
  title: string;
  /** 카드 폭(px). 가상 화면을 이만큼으로 줄인다. */
  width: number;
}

export const PagePreview = memo(function PagePreview({ url, title, width }: PagePreviewProps) {
  const host = hostOf(url);
  return (
    <span
      className="pp"
      style={{ '--pp-hue': hueForSession(host || url), '--pp-scale': width / PREVIEW_WIDTH } as React.CSSProperties}
    >
      <span className={`pp__page pp--${kindOf(host)}`}>
        <Sketch kind={kindOf(host)} url={url} host={host} title={title} />
      </span>
    </span>
  );
});
