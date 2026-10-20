/**
 * 2번 현수막 — ORBIT. 흩어졌던 페이지가 세션 하나로 정돈되고, 공간 속에서 넘겨 볼 수 있다.
 *
 * 그림은 실제 화면을 겹으로 나눠 다시 쌓았다: 위 막대(아틀라스의 세션 줄과 점), 가운데 세션 갤러리와 바닥의 궤도,
 * 앞 오른쪽 사이드패널 타임라인. 왼쪽 네비게이터도 시험했으나 막대와 겹쳐 읽기를 해쳐 뺐다. 데이터는 합성 시연 데이터다.
 */
import type { RefObject } from 'react';
import { GALLERY_SESSION_IDS, SESSIONS, sessionById, type ExhibitSession } from './content';
import { BannerFrame, Favicon } from './frame';
import { SessionGallery } from './gallery';

interface OrbitBannerProps {
  sessionIndex: number;
  pageIndex: number;
  onSession: (index: number) => void;
  onPage: (index: number) => void;
  interactive: boolean;
  scaleRef: RefObject<number>;
}

export function OrbitBanner({ sessionIndex, pageIndex, onSession, onPage, interactive, scaleRef }: OrbitBannerProps) {
  const session = sessionById(GALLERY_SESSION_IDS[sessionIndex]);
  const step = (delta: number) => onSession((sessionIndex + delta + GALLERY_SESSION_IDS.length) % GALLERY_SESSION_IDS.length);

  return (
    <BannerFrame index={1} label="현수막 2 — ORBIT">
      <section className="ex-orbit__intro">
        <h1 className="ex-orbit__word">
          Orbit<span>.</span>
        </h1>
        <p className="ex-orbit__sub">당신의 탐색을 기억하다.</p>
        <p className="ex-orbit__en">Personal Exploration Memory</p>
      </section>

      <section className="ex-orbit__stage" aria-label="세션 갤러리" style={{ ['--stage-hue' as string]: session.hue }}>
        <Rail session={session} sessionIndex={sessionIndex} pageIndex={pageIndex} onStep={step} interactive={interactive} />
        <div className="ex-orbit__gallery" key={session.id}>
          <SessionGallery session={session} selected={pageIndex} onSelect={onPage} interactive={interactive} scaleRef={scaleRef} />
        </div>
        <Timeline session={session} pageIndex={pageIndex} />
        {/* 아틀라스 세부 정보의 "세션 요약" — 방문을 읽고 AI가 쓴 개요와 핵심(합성 데이터) */}
        <div className="ex-orbit__summary">
          <span className="ex-orbit__summary-label">
            <i className="ph ph-sparkle" />
            세션 요약
          </span>
          <p>{session.overview}</p>
          <ul>
            {session.highlights.slice(0, 3).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="ex-features" aria-label="핵심 기능">
        {FEATURES.map((feature, index) => (
          <div className="ex-feature" key={feature.ko}>
            <span className="ex-feature__no">{String(index + 1).padStart(2, '0')}</span>
            <h2 className="ex-feature__en">
              {feature.en[0]}
              <br />
              {feature.en[1]}
            </h2>
            <div className="ex-feature__body">
              <h3>{feature.ko}</h3>
              <p>{feature.text}</p>
            </div>
          </div>
        ))}
      </section>

      <p className="ex-fineprint ex-orbit__fineprint">
        그림: 새 탭 아틀라스의 막대·세션 갤러리와 사이드패널 타임라인
        <br />
        세션과 방문은 시연용 합성 데이터, 카드 속 화면은 공개 웹페이지 캡처(2026-10-20)
      </p>
    </BannerFrame>
  );
}

/** 문구는 지금 구현에 맞춘다 — 근거는 각 줄 옆의 코드 경로. */
const FEATURES = [
  {
    en: ['Automatic Session', 'Organization'],
    ko: '흩어진 방문이 스스로 세션이 된다',
    // backend/app/services/sync_pipeline.py · intent_analyzer.py · summarizer.py
    text: '방문을 시간과 주제로 나눈 뒤, AI가 기존 세션에 이어 붙일지 새로 만들지 판단하고 제목과 요약을 씁니다.',
  },
  {
    en: ['Semantic', 'Search'],
    ko: '기억나는 말로 찾는다',
    // backend/app/api/search.py (scope=memory)
    text: '“제주 렌터카 비교하던 거”처럼 물으면 뜻이 가까운 세션과 그 안의 방문 기록을 함께 찾아 줍니다.',
  },
  {
    en: ['Context', 'Restoration'],
    ko: '멈춘 자리에서 다시 시작한다',
    // extension/entrypoints/newtab/lib/restore.ts · 아틀라스 세부 정보의 "다음 할 일"
    text: '세션의 페이지를 탭으로 한 번에 다시 열고, 요약과 다음 할 일로 하던 일을 이어 갑니다.',
  },
];

function Rail({
  session,
  sessionIndex,
  pageIndex,
  onStep,
  interactive,
}: {
  session: ExhibitSession;
  sessionIndex: number;
  pageIndex: number;
  onStep: (delta: number) => void;
  interactive: boolean;
}) {
  // 아틀라스 막대처럼 같은 폴더의 세션만 위아래 줄로 — 지금 세션이 가운데 줄
  const neighbor = (delta: number) => {
    const id = GALLERY_SESSION_IDS[sessionIndex + delta];
    const other = id ? sessionById(id) : null;
    return other && other.folder === session.folder ? other : null;
  };
  const [previous, next] = [neighbor(-1), neighbor(1)];
  const groupSize = SESSIONS.filter((other) => other.folder === session.folder).length;
  return (
    <div className="ex-rail">
      <div className="ex-rail__group">
        <span>
          {session.folder ?? '정리 안 됨'} · 세션 {groupSize}개
        </span>
        <button type="button" onClick={() => onStep(-1)} disabled={!interactive} aria-label="이전 세션">
          <i className="ph ph-caret-up" />
        </button>
        <button type="button" onClick={() => onStep(1)} disabled={!interactive} aria-label="다음 세션">
          <i className="ph ph-caret-down" />
        </button>
      </div>
      <div className="ex-rail__rows">
        {previous ? <RailRow session={previous} pageIndex={0} /> : <div className="ex-rail__row" />}
        <RailRow session={session} current pageIndex={pageIndex} />
        {next ? <RailRow session={next} pageIndex={0} /> : <div className="ex-rail__row" />}
      </div>
    </div>
  );
}

function RailRow({ session, current = false, pageIndex }: { session: ExhibitSession; current?: boolean; pageIndex: number }) {
  const total = session.pages.length;
  return (
    <div className={`ex-rail__row${current ? ' is-current' : ''}`} style={{ ['--hue' as string]: session.hue }}>
      <span className="ex-rail__title">{session.title}</span>
      <span className="ex-rail__track">
        <i className="ex-rail__line" />
        {session.pages.map((page, index) => {
          // 고른 페이지가 늘 가운데 — 아틀라스 막대와 같다.
          const away = ((index - pageIndex + total + Math.floor(total / 2)) % total) - Math.floor(total / 2);
          // 고리의 반대편(이음매)에 있는 점은 갤러리 카드처럼 숨는다
          if (Math.abs(away) >= total / 2) return null;
          return <i key={page.id} className={`ex-rail__dot${away === 0 && current ? ' is-on' : ''}`} style={{ left: `calc(50% + ${away * 34}px)` }} />;
        })}
      </span>
      <span className="ex-rail__count">{current ? `${pageIndex + 1} / ${total}` : `${total}p`}</span>
    </div>
  );
}

/**
 * 사이드패널 타임라인 — 시각 · 파비콘 · 제목 · 체류(TimelineItem 과 같은 줄). 모두 같은 세션이라
 * 줄마다 붙는 세션 배지는 머리줄에 한 번만 둔다.
 */
function Timeline({ session, pageIndex }: { session: ExhibitSession; pageIndex: number }) {
  return (
    <div className="ex-layer ex-timeline" aria-hidden style={{ ['--hue' as string]: session.hue }}>
      <div className="ex-timeline__tabs">
        <b>타임라인</b>
        <span>세션</span>
        <span>열린 탭</span>
      </div>
      <div className="ex-timeline__date">
        <span>{session.day}</span>
        <span className="ex-timeline__badge">{session.title}</span>
      </div>
      {[...session.pages].reverse().map((page) => (
        <div key={page.id} className={`ex-timeline__row${page.id === session.pages[pageIndex]?.id ? ' is-on' : ''}`}>
          <span className="ex-timeline__time">{page.time}</span>
          <Favicon url={page.url} domain={page.domain} />
          <span className="ex-timeline__title">{page.title}</span>
          <span className="ex-timeline__dur">{page.minutes}분</span>
        </div>
      ))}
    </div>
  );
}
