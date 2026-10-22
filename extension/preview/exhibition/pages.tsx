/**
 * 가상 데모 페이지 — 카드 속 "웹페이지 화면"을 캡처 대신 직접 그린다. 실존 사이트를 흉내 내지 않는다.
 *
 * 페이지는 1000 × 1300 가상 화면으로 그리고 카드 폭에 맞춰 줄인다(scale). 사진은 쓰지 않고
 * 도형과 색으로만 그린 그림(Art)을 쓴다. 글자는 벡터라 인쇄 크기에서도 선명하다.
 */
import type { CSSProperties, ReactNode } from 'react';
import { SITES, type Art, type DemoPage, type Item, type Site } from './demo';

export const PAGE_WIDTH = 1000;
export const PAGE_HEIGHT = 1300;

/** 카드 폭(width)에 맞춰 줄인 데모 페이지 */
export function DemoPageView({ page, width }: { page: DemoPage; width: number }) {
  const site = SITES[page.site];
  const style = { '--c': site.color, '--t': site.tint, transform: `scale(${width / PAGE_WIDTH})` } as CSSProperties;
  return (
    <div className={`dp dp--${page.kind}`} style={style} aria-hidden>
      <SiteHeader site={site} kind={page.kind} />
      {BODIES[page.kind](page)}
    </div>
  );
}

/** 가상 사이트의 머리 모양 — 파비콘 자리와 사이트 머리에 같이 쓴다 */
export function SiteMark({ site, size }: { site: Site; size?: number }) {
  return (
    <i
      className={`dp-mark dp-mark--${site.mark}`}
      style={{ '--c': site.color, width: size, height: size, fontSize: size ? size * 0.56 : undefined } as CSSProperties}
    >
      {site.name.charAt(0)}
    </i>
  );
}

const NAV: Record<DemoPage['kind'], string[]> = {
  search: ['둘러보기', '특가', '예약 내역'],
  blog: ['최신 글', '여행지', '구독'],
  docs: ['가이드', '참고', '예제'],
  qa: ['질문', '태그', '사용자'],
  map: ['주변', '저장', '길찾기'],
  weather: ['오늘', '주간', '바다'],
  shop: ['카테고리', '랭킹', '장바구니'],
  list: ['지역', '테마', '저장'],
  guide: ['안내', '자주 묻는 질문', '상담'],
  issue: ['코드', '이슈', '토론'],
};

function SiteHeader({ site, kind }: { site: Site; kind: DemoPage['kind'] }) {
  return (
    <header className="dp-head">
      <span className="dp-logo">
        <SiteMark site={site} />
        {site.name}
      </span>
      <nav>
        {NAV[kind].map((item) => (
          <span key={item}>{item}</span>
        ))}
      </nav>
      <span className="dp-avatar" />
    </header>
  );
}

const Bars = ({ widths }: { widths: number[] }) => (
  <div className="dp-bars">
    {widths.map((width, index) => (
      <i key={index} style={{ width: `${width}%` }} />
    ))}
  </div>
);

const BODIES: Record<DemoPage['kind'], (page: DemoPage) => ReactNode> = {
  search: (page) => (
    <>
      <section className="dp-hero">
        <div>
          <h1>{page.heading}</h1>
          <div className="dp-searchbar">
            {(page.query ?? []).map((field) => (
              <span key={field}>{field}</span>
            ))}
            <b>검색</b>
          </div>
        </div>
        {page.art && <ArtView art={page.art} />}
      </section>
      <div className="dp-chips">
        {['추천 순', '가격 낮은 순', '필터'].map((chip, index) => (
          <span key={chip} className={index === 0 ? 'is-on' : undefined}>
            {chip}
          </span>
        ))}
      </div>
      <ul className="dp-results">
        {(page.items ?? []).map((item) => (
          <ResultRow key={item.title} item={item} art={item.art ?? page.art} />
        ))}
      </ul>
    </>
  ),
  blog: (page) => (
    <article className="dp-article">
      <p className="dp-crumb">{SITES[page.site].name} · 글</p>
      <h1>{page.heading}</h1>
      <div className="dp-byline">
        <span className="dp-avatar" />
        <span>글쓴이 · 11월 2일 · 읽는 시간 5분</span>
      </div>
      {page.art && (
        <figure className="dp-figure">
          <ArtView art={page.art} />
        </figure>
      )}
      {(page.lines ?? []).map((line, index) => (index > 0 && index % 2 === 0 ? <h2 key={line}>{line}</h2> : <p key={line}>{line}</p>))}
      <Bars widths={[96, 92, 88, 64]} />
    </article>
  ),
  docs: (page) => (
    <div className="dp-docs">
      <aside className="dp-side">
        {['시작하기', '기본 개념', '데이터', '세션', '오류 처리', '배포', '참고'].map((item, index) => (
          <span key={item} className={index === 3 ? 'is-on' : undefined}>
            {item}
          </span>
        ))}
      </aside>
      <main>
        <p className="dp-crumb">가이드 / {page.heading.split(' ')[0]}</p>
        <h1>{page.heading}</h1>
        {(page.lines ?? []).map((line) => (
          <p key={line}>{line}</p>
        ))}
        {page.code && <Code lines={page.code} />}
        <div className="dp-note">참고 · 요청이 끝나면 세션도 닫힌다.</div>
        <Bars widths={[94, 86, 90, 58]} />
      </main>
    </div>
  ),
  qa: (page) => (
    <div className="dp-qa">
      <h1>{page.heading}</h1>
      <p className="dp-meta">3일 전 질문 · 조회 1.2천 · 답변 3</p>
      <div className="dp-qbody">
        <div className="dp-votes">
          <i />
          <b>24</b>
          <i />
        </div>
        <div>
          {(page.lines ?? []).slice(0, 1).map((line) => (
            <p key={line}>{line}</p>
          ))}
          {page.code && <Code lines={page.code} />}
          <div className="dp-tags">
            {['비동기', '데이터베이스', '세션'].map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        </div>
      </div>
      <h2>답변 3</h2>
      <div className="dp-answer">
        <span className="dp-check">✓</span>
        <div>
          {(page.lines ?? []).slice(1).map((line) => (
            <p key={line}>{line}</p>
          ))}
          <Bars widths={[90, 76]} />
        </div>
      </div>
      <div className="dp-answer is-plain">
        <Bars widths={[88, 70, 52]} />
      </div>
    </div>
  ),
  map: (page) => (
    <div className="dp-map">
      <MapArt />
      <div className="dp-mapsearch">{page.heading} 근처 맛집</div>
      <div className="dp-sheet">
        {(page.items ?? []).map((item, index) => (
          <div key={item.title} className="dp-sheet__row">
            <b>{index + 1}</b>
            <span>{item.title}</span>
            <em>도보 {4 + index * 3}분</em>
          </div>
        ))}
      </div>
    </div>
  ),
  weather: (page) => (
    <div className="dp-weather">
      <p className="dp-place">{page.heading}</p>
      <div className="dp-now">
        <b>17°</b>
        <SunCloud />
      </div>
      <p className="dp-meta">평균 최고 19° · 최저 12° · 바람 약함</p>
      <ul className="dp-hours">
        {['09시', '12시', '15시', '18시', '21시'].map((hour, index) => (
          <li key={hour}>
            <span>{hour}</span>
            <i className={index === 2 ? 'is-cloud' : undefined} />
            <b>{[14, 18, 19, 16, 13][index]}°</b>
          </li>
        ))}
      </ul>
      <ul className="dp-days">
        {(page.items ?? []).map((item) => (
          <li key={item.title}>
            <span>{item.title}</span>
            <em>{item.meta}</em>
            <b>{item.price}</b>
          </li>
        ))}
      </ul>
    </div>
  ),
  shop: (page) => (
    <div className="dp-shop">
      <h1>{page.heading}</h1>
      <div className="dp-chips">
        {['전체', '인기', '새로 나온', '할인'].map((chip, index) => (
          <span key={chip} className={index === 1 ? 'is-on' : undefined}>
            {chip}
          </span>
        ))}
      </div>
      <div className="dp-grid">
        {(page.items ?? []).map((item) => (
          <div key={item.title} className="dp-tile">
            <div className="dp-tile__art">{item.art && <ArtView art={item.art} />}</div>
            <b>{item.title}</b>
            {item.meta && <span>{item.meta}</span>}
            {item.price && <em>{item.price}</em>}
          </div>
        ))}
      </div>
    </div>
  ),
  list: (page) => (
    <div className="dp-list">
      <h1>{page.heading}</h1>
      <div className="dp-chips">
        {['전체', '전망', '주차', '디저트'].map((chip, index) => (
          <span key={chip} className={index === 0 ? 'is-on' : undefined}>
            {chip}
          </span>
        ))}
      </div>
      {(page.items ?? []).map((item, index) => (
        <div key={item.title} className="dp-rank">
          <b>{index + 1}</b>
          <div className="dp-rank__art">{item.art && <ArtView art={item.art} />}</div>
          <div>
            <h3>{item.title}</h3>
            <span>{item.meta}</span>
            <Bars widths={[80, 56]} />
          </div>
        </div>
      ))}
    </div>
  ),
  guide: (page) => (
    <div className="dp-guide">
      <span className="dp-kicker">안내</span>
      <h1>{page.heading}</h1>
      <Bars widths={[92, 70]} />
      <ol className="dp-steps">
        {(page.items ?? []).map((item, index) => (
          <li key={item.title}>
            <b>{index + 1}</b>
            <div>
              <h3>{item.title}</h3>
              <Bars widths={[84, 60]} />
            </div>
          </li>
        ))}
      </ol>
      <div className="dp-note">계약 전날 한 번 더 확인하세요.</div>
    </div>
  ),
  issue: (page) => (
    <div className="dp-issue">
      <p className="dp-repo">orbit-lab / async-db</p>
      <div className="dp-chips">
        {['코드', '이슈 31', '토론', '설정'].map((chip, index) => (
          <span key={chip} className={index === 1 ? 'is-on' : undefined}>
            {chip}
          </span>
        ))}
      </div>
      <h1>
        {page.heading} <span>#31</span>
      </h1>
      <span className="dp-state">열림</span>
      {(page.lines ?? []).map((line) => (
        <div key={line} className="dp-comment">
          <span className="dp-avatar" />
          <div>
            <p>{line}</p>
            <Bars widths={[76, 48]} />
          </div>
        </div>
      ))}
    </div>
  ),
};

function ResultRow({ item, art }: { item: Item; art?: Art }) {
  return (
    <li className="dp-result">
      <div className="dp-result__art">{art && <ArtView art={art} />}</div>
      <div className="dp-result__text">
        <h3>
          {item.title}
          {item.badge && <span className="dp-badge">{item.badge}</span>}
        </h3>
        {item.meta && <p>{item.meta}</p>}
      </div>
      {item.price && (
        <div className="dp-result__price">
          <b>{item.price}</b>
          <span>선택</span>
        </div>
      )}
    </li>
  );
}

/** 코드 줄 — 키워드만 옅게 칠한다 */
function Code({ lines }: { lines: string[] }) {
  return (
    <pre className="dp-code">
      {lines.map((line, index) => (
        <span key={index}>
          {line.split(/(\b(?:async|await|def|with|as|return|const|function|yield)\b)/).map((part, at) =>
            at % 2 === 1 ? <em key={at}>{part}</em> : part,
          )}
          {'\n'}
        </span>
      ))}
    </pre>
  );
}

// ── 그림 — 사진 대신 도형과 색. 사이트 대표색(--c)과 옅은 색(--t)을 따른다 ───────────────

export function ArtView({ art }: { art: Art }) {
  return (
    <svg className="dp-art" viewBox="0 0 200 140" preserveAspectRatio="xMidYMid slice" aria-hidden>
      {ART[art]}
    </svg>
  );
}

const ART: Record<Art, ReactNode> = {
  plane: (
    <>
      <rect width="200" height="140" fill="var(--t)" />
      <circle cx="152" cy="40" r="18" fill="#fff" opacity="0.9" />
      <path d="M20 104 Q70 92 120 98 T200 92 V140 H0 V108Z" fill="#fff" opacity="0.7" />
      <g transform="translate(58 46) rotate(-12)" fill="var(--c)">
        <rect x="0" y="16" width="92" height="12" rx="6" />
        <path d="M38 22 L60 -6 L70 -6 L58 22Z M40 22 L62 50 L72 50 L60 22Z M4 22 L0 8 L8 8 L16 22Z" />
      </g>
    </>
  ),
  car: (
    <>
      <rect width="200" height="140" fill="var(--t)" />
      <rect x="0" y="104" width="200" height="36" fill="#fff" opacity="0.6" />
      <path d="M34 98 Q36 74 62 70 L84 52 Q90 48 100 48 H132 Q142 48 148 56 L162 72 Q176 76 176 92 V98Z" fill="var(--c)" />
      <path d="M90 56 H126 Q132 56 136 62 L144 72 H80Z" fill="#fff" opacity="0.85" />
      <circle cx="70" cy="100" r="13" fill="#2b2521" />
      <circle cx="146" cy="100" r="13" fill="#2b2521" />
      <circle cx="70" cy="100" r="5" fill="#fff" />
      <circle cx="146" cy="100" r="5" fill="#fff" />
    </>
  ),
  hotel: (
    <>
      <rect width="200" height="140" fill="#fff" />
      <rect width="200" height="84" fill="var(--t)" />
      <rect y="84" width="200" height="56" fill="var(--c)" opacity="0.55" />
      <path d="M0 96 Q25 90 50 96 T100 96 T150 96 T200 96" stroke="#fff" strokeWidth="3" fill="none" opacity="0.8" />
      <rect x="58" y="22" width="56" height="64" rx="3" fill="#fff" />
      <rect x="118" y="38" width="34" height="48" rx="3" fill="#fff" opacity="0.9" />
      {[0, 1, 2, 3].map((row) =>
        [0, 1, 2].map((col) => <rect key={`${row}-${col}`} x={64 + col * 16} y={28 + row * 14} width="10" height="8" rx="1.5" fill="var(--c)" opacity="0.5" />),
      )}
    </>
  ),
  island: (
    <>
      <rect width="200" height="140" fill="var(--t)" />
      <rect y="70" width="200" height="70" fill="#5aa7d6" opacity="0.55" />
      <path d="M30 82 Q60 40 100 46 Q140 50 168 82Z" fill="#7fa452" />
      <path d="M86 50 Q100 30 116 50Z" fill="#5f8a3a" />
      <circle cx="160" cy="30" r="12" fill="#fff" />
      <path d="M0 100 Q40 94 80 100 T160 100 T240 100" stroke="#fff" strokeWidth="3" fill="none" opacity="0.7" />
    </>
  ),
  cup: (
    <>
      <rect width="200" height="140" fill="var(--t)" />
      <ellipse cx="100" cy="112" rx="58" ry="10" fill="#fff" />
      <path d="M62 60 H130 V92 Q130 110 110 110 H82 Q62 110 62 92Z" fill="var(--c)" />
      <path d="M130 68 Q150 68 150 82 Q150 96 130 96" stroke="var(--c)" strokeWidth="7" fill="none" />
      <path d="M84 30 Q78 40 86 48 M100 26 Q94 36 102 46 M116 30 Q110 40 118 48" stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" />
    </>
  ),
  food: (
    <>
      <rect width="200" height="140" fill="var(--t)" />
      <circle cx="100" cy="74" r="50" fill="#fff" />
      <circle cx="100" cy="74" r="38" fill="var(--c)" opacity="0.18" />
      <circle cx="86" cy="66" r="12" fill="#e09528" />
      <circle cx="112" cy="62" r="10" fill="#7fa452" />
      <circle cx="106" cy="88" r="13" fill="var(--c)" opacity="0.8" />
      <rect x="150" y="34" width="6" height="80" rx="3" fill="#2b2521" opacity="0.5" />
    </>
  ),
  shoe: (
    <>
      <rect width="200" height="140" fill="var(--t)" />
      <path d="M30 96 Q34 64 62 58 L96 70 Q120 76 150 78 Q176 82 176 98 Q176 106 168 106 H40 Q30 106 30 96Z" fill="var(--c)" />
      <rect x="30" y="100" width="146" height="10" rx="5" fill="#fff" />
      <path d="M70 66 L80 80 M82 70 L92 84 M94 74 L104 86" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
    </>
  ),
  gpu: (
    <>
      <rect width="200" height="140" fill="var(--t)" />
      <rect x="18" y="34" width="164" height="70" rx="10" fill="#2f2a26" />
      <circle cx="66" cy="69" r="26" fill="#3f3833" />
      <circle cx="134" cy="69" r="26" fill="#3f3833" />
      {[66, 134].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="69" r="20" fill="none" stroke="#5c534c" strokeWidth="2" />
          <circle cx={cx} cy="69" r="6" fill="var(--c)" />
        </g>
      ))}
      <rect x="18" y="104" width="120" height="8" rx="2" fill="#d6b85c" />
    </>
  ),
  buds: (
    <>
      <rect width="200" height="140" fill="var(--t)" />
      {/* 충전 케이스와 이어폰 두 개 */}
      <rect x="56" y="62" width="88" height="56" rx="24" fill="#fff" />
      <line x1="60" y1="80" x2="140" y2="80" stroke="var(--t)" strokeWidth="3" />
      {[78, 122].map((cx, index) => (
        <g key={cx} transform={`rotate(${index === 0 ? -14 : 14} ${cx} 46)`}>
          <circle cx={cx} cy="40" r="15" fill="var(--c)" />
          <rect x={cx - 5} y="44" width="10" height="30" rx="5" fill="var(--c)" />
          <circle cx={cx} cy="40" r="6" fill="#fff" opacity="0.55" />
        </g>
      ))}
    </>
  ),
  city: (
    <>
      <rect width="200" height="140" fill="var(--t)" />
      {[[10, 60, 30], [44, 40, 24], [72, 70, 34], [110, 30, 26], [140, 56, 22], [166, 46, 28]].map(([x, y, w]) => (
        <rect key={x} x={x} y={y} width={w} height={140 - y} fill="var(--c)" opacity={0.35 + (x % 3) * 0.15} />
      ))}
      <rect y="112" width="200" height="28" fill="#5aa7d6" opacity="0.5" />
    </>
  ),
  slide: (
    <>
      <rect width="200" height="140" fill="var(--t)" />
      <rect x="26" y="22" width="148" height="96" rx="6" fill="#fff" />
      <rect x="38" y="34" width="64" height="10" rx="3" fill="#2b2521" opacity="0.75" />
      <rect x="38" y="52" width="44" height="6" rx="3" fill="#2b2521" opacity="0.25" />
      <circle cx="140" cy="76" r="22" fill="var(--c)" opacity="0.8" />
      <rect x="38" y="84" width="20" height="22" rx="2" fill="var(--c)" opacity="0.35" />
      <rect x="62" y="74" width="20" height="32" rx="2" fill="var(--c)" opacity="0.55" />
    </>
  ),
  house: (
    <>
      <rect width="200" height="140" fill="var(--t)" />
      <path d="M50 70 L100 30 L150 70Z" fill="var(--c)" />
      <rect x="62" y="70" width="76" height="50" fill="#fff" />
      <rect x="92" y="88" width="16" height="32" fill="var(--c)" opacity="0.6" />
      <rect x="0" y="120" width="200" height="20" fill="#7fa452" opacity="0.45" />
    </>
  ),
  mic: (
    <>
      <rect width="200" height="140" fill="var(--t)" />
      <rect x="86" y="26" width="28" height="56" rx="14" fill="var(--c)" />
      <path d="M74 66 Q74 96 100 96 Q126 96 126 66" stroke="var(--c)" strokeWidth="6" fill="none" />
      <rect x="97" y="96" width="6" height="18" fill="var(--c)" />
      <path d="M52 50 Q44 62 52 74 M148 50 Q156 62 148 74" stroke="#fff" strokeWidth="5" fill="none" strokeLinecap="round" />
    </>
  ),
  wave: (
    <>
      <rect width="200" height="140" fill="var(--t)" />
      {[60, 84, 108].map((y) => (
        <path key={y} d={`M0 ${y} Q25 ${y - 10} 50 ${y} T100 ${y} T150 ${y} T200 ${y}`} stroke="var(--c)" strokeWidth="5" fill="none" opacity="0.5" />
      ))}
    </>
  ),
};

function SunCloud() {
  return (
    <svg className="dp-suncloud" viewBox="0 0 120 90" aria-hidden>
      <circle cx="46" cy="38" r="24" fill="#f2b33d" />
      <path d="M38 74 Q20 74 20 60 Q20 46 36 46 Q42 30 62 32 Q80 34 82 50 Q98 50 98 62 Q98 74 84 74Z" fill="#fff" stroke="var(--t)" strokeWidth="3" />
    </svg>
  );
}

function MapArt() {
  return (
    <svg className="dp-mapart" viewBox="0 0 1000 1300" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <rect width="1000" height="1300" fill="#eef1ec" />
      <path d="M0 860 Q300 780 520 860 T1000 820 V1300 H0Z" fill="#cfe3ef" />
      <path d="M120 0 L180 1300 M0 380 L1000 300 M0 620 L1000 680 M620 0 L560 1300 M820 0 L900 1300" stroke="#fff" strokeWidth="26" />
      <path d="M0 500 L1000 470 M360 0 L420 1300" stroke="#fff" strokeWidth="12" />
      <rect x="220" y="420" width="130" height="150" rx="14" fill="#dfe8d6" />
      <rect x="660" y="360" width="140" height="120" rx="14" fill="#dfe8d6" />
      {[[300, 330], [520, 560], [740, 610]].map(([x, y], index) => (
        <g key={x} transform={`translate(${x} ${y})`}>
          <path d="M0 0 Q-34 -40 0 -78 Q34 -40 0 0Z" fill="var(--c)" />
          <circle cy="-46" r="14" fill="#fff" />
          <text y="-38" textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--c)">
            {index + 1}
          </text>
        </g>
      ))}
    </svg>
  );
}
