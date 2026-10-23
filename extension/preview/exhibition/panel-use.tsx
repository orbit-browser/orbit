/**
 * 왼쪽 벽 — USE. 처음 쓰는 사람이 무엇을 하면 되는지와, 기록을 어떻게 다루는지.
 *
 * 화면 조각은 실제 UI 의 모양과 문구를 옮겼다: 사이드패널 수집 안내(CollectionOptInNotice),
 * 사이드패널 타임라인(TimelineItem), 새 탭 "이어서 탐색하기" 카드(ExploreCard), 새 탭 검색창(OrbitHero).
 * 원칙 여섯 줄은 코드에서 확인한 것만 쓴다(각 줄 옆 주석).
 */
import { sessionById } from './content';
import { BannerFrame, Favicon } from './frame';

// 문구는 부스 앞에서 소리 내어 읽었을 때 사람 말이 되게 쓴다(마케팅팀장 문구 원칙, 2026-10-23).
// 제목은 "~한다" 선언 대신 설명하는 사람의 말투로, 같은 주장은 그대로 둔다.
const STEPS = [
  {
    title: '수집을 켭니다',
    text: '처음에는 꺼져 있습니다. 켜고 끄는 것은 언제든 내가 합니다.',
    ui: <OptIn />,
  },
  {
    title: '평소처럼 웹을 봅니다',
    text: '본 페이지는 먼저 내 브라우저에 쌓였다가, 정해 둔 때에 한꺼번에 정리됩니다. 페이지마다 AI를 부르지 않습니다.',
    ui: <TimelineMini />,
  },
  {
    title: 'AI가 세션으로 묶습니다',
    text: '같은 일을 하며 본 페이지를 한데 모으고, 제목과 요약, 다음 할 일까지 씁니다.',
    ui: <SessionCard />,
  },
  {
    title: '생각나는 대로 찾아서 다시 엽니다',
    text: '새 탭에 그때 하던 일을 적으면 그 세션이 나옵니다. 그 안의 페이지는 탭으로 한\u00a0번에 다시 열립니다.',
    ui: <SearchBox />,
  },
];

const PRINCIPLES = [
  // lib/settings.ts collectionEnabled: false
  ['내가 켜야 시작합니다', '설치한 뒤에도 꺼져 있고, 켠 뒤에도 언제든 끌 수 있습니다.'],
  // lib/sensitive-domains.ts · backend app/api/events.py is_sensitive_url
  ['민감한 페이지는 본문을 남기지 않습니다', '은행·로그인 같은 페이지는 제목과 주소만 남깁니다. 확장과 서버가 두 번 거릅니다.'],
  // lib/events/queue.ts (IndexedDB) · lib/sync/engine.ts
  ['먼저 내 브라우저에 쌓입니다', '서버로 보내기 전까지는 기기 안의 큐에만 있습니다.'],
  // wxt.config.ts permissions — history 없음
  // "방문 기록을 읽지 않는다"로 넓히지 않는다 — topSites(자주 간 사이트) 권한은 있다
  ['브라우저 방문 기록 권한은 받지 않습니다', '페이지를 옮길 때마다 webNavigation으로 알아챕니다.'],
  // backend app/services/event_filter.py normalize_url
  ['추적 꼬리표는 지우고 저장합니다', '주소 끝에 붙는 utm·gclid·fbclid 같은 값입니다.'],
  // backend tab_action_resolver.py (low_confidence → ask) · config auto_merge_enabled False
  ['확실하지 않으면 AI가 먼저 묻습니다', '탭을 옮기지 않고 후보만 보여 줍니다. 세션 자동 병합도 처음엔 꺼져 있습니다.'],
];

export function UseBanner() {
  return (
    <BannerFrame step={0} label="현수막 — USE">
      <section className="ex-use__intro">
        <h1 className="ex-use__title">
          북마크 안 해도
          <br />
          찾을 수 있어요.
        </h1>
        <p className="ex-use__sub">수집을 한 번 켜 두면, 평소처럼 웹을 보는 동안 본 페이지가 알아서 세션으로 정리됩니다.</p>
        {/* 행동 유도 — 두 앞 띠와 같은 말 */}
        <p className="ex-cta">
          <i className="ph ph-arrow-right" />
          지금 써 보세요 · 시연은 가운데 화면에서 · 설치 QR은 오른쪽 끝에
        </p>
      </section>

      <ol className="ex-howto" aria-label="쓰는 법">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <div className="ex-howto__text">
              <b>{String(index + 1).padStart(2, '0')}</b>
              <h2>{step.title}</h2>
              <p>{step.text}</p>
            </div>
            <div className="ex-howto__ui">{step.ui}</div>
          </li>
        ))}
      </ol>

      <section className="ex-privacy" aria-label="기록을 다루는 원칙">
        <div className="ex-section-head">
          <h2>Privacy by Default</h2>
          <span className="ex-status">코드로 확인한 동작</span>
        </div>
        <ul>
          {PRINCIPLES.map(([head, text]) => (
            <li key={head}>
              <b>{head}</b>
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </section>
    </BannerFrame>
  );
}

/**
 * 사이드패널 수집 안내(CollectionOptInNotice). 제품 문구의 "민감한 도메인은 자동으로 제외돼요"는 실제 동작과 다르다 —
 * 민감한 주소는 본문만 건너뛰고 방문(제목·주소)은 남긴다(collector.ts, event_filter.is_sensitive_url). 현수막은 동작대로 쓴다.
 */
function OptIn() {
  return (
    <div className="ex-ui ex-ui--optin">
      <i className="ph ph-sparkle" />
      <b>탐색 기록을 자동으로 모아볼까요?</b>
      <span>방문한 페이지를 시간순으로 기록해 나중에 다시 찾을 수 있게 해줘요. 은행·로그인 같은 민감한 페이지는 본문을 남기지 않아요.</span>
      <em>수집 켜기</em>
    </div>
  );
}

/** 사이드패널 타임라인 — 시각 · 사이트 · 제목 · 체류 */
function TimelineMini() {
  const jeju = sessionById('s-jeju');
  return (
    <div className="ex-ui ex-ui--timeline">
      <div className="ex-timeline__tabs">
        <b>타임라인</b>
        <span>세션</span>
        <span>열린 탭</span>
      </div>
      {jeju.pages.slice(0, 4).map((page) => (
        <div key={page.id} className="ex-timeline__row">
          <span className="ex-timeline__time">{page.time}</span>
          <Favicon url={page.url} domain={page.domain} />
          <span className="ex-timeline__title">{page.title}</span>
          <span className="ex-timeline__dur">{page.minutes}분</span>
        </div>
      ))}
    </div>
  );
}

/** 새 탭 "이어서 탐색하기" 카드 */
function SessionCard() {
  const jeju = sessionById('s-jeju');
  return (
    <div className="ex-ui ex-ui--session" style={{ ['--hue' as string]: jeju.hue }}>
      <div className="ex-ui__row">
        <span className="ex-ui__badge">최근 세션</span>
        <span className="ex-ui__muted">{jeju.day}</span>
      </div>
      <b>{jeju.title}</b>
      <span>{jeju.overview}</span>
      <div className="ex-ui__row">
        <span className="ex-ui__meta">
          <i className="ph ph-graph" /> 탐색 세션 · 페이지 {jeju.pages.length}개 · {jeju.minutes}분
        </span>
        <em>세션 복원</em>
      </div>
    </div>
  );
}

/** 새 탭 검색창 — AI 에게 질문 모드 */
function SearchBox() {
  const jeju = sessionById('s-jeju');
  return (
    <div className="ex-ui ex-ui--search">
      <div className="ex-ui__box">
        <span>제주 렌터카 비교하던 거</span>
        <i>Tab 전환</i>
        <span className="ex-ui__toggle">
          <span>검색</span>
          <b>AI에게 질문</b>
        </span>
      </div>
      {/* 새 탭 Ask 답변 아래 "관련 세션" 카드(AskConversationPanel) */}
      <span className="ex-ui__label">관련 세션</span>
      <div className="ex-ui__hit">
        <b>1</b>
        <span>
          <strong>{jeju.title}</strong>
          <small>
            {jeju.pages.length}개 페이지 · {jeju.day}
          </small>
        </span>
      </div>
    </div>
  );
}
