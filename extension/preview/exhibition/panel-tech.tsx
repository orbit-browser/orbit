/**
 * 5번 현수막 — TECHNOLOGY. 파이프라인은 지금 코드에서 확인한 것만 쓴다(각 단계의 source).
 * 서버 성능은 metrics.json, 이번 UI 시험의 비율은 원본 CSV에서 계산한다.
 */
import { SESSION_HUES } from '../../lib/session-hue';
import { BannerFrame } from './frame';
import { METRICS, displayMeasure, isMeasured, type Metric } from './metrics';
import { REFUSAL_HIGHLIGHT } from './trial-highlights';

/** 지금 설정의 모델(2026-10-20). 코드 기본값은 A.X-K1 이고 운영 설정이 A.X-K2 다 — 바뀌면 여기만 고친다. */
const MODELS = {
  // 모델 이름은 줄에서 갈라지지 않게(줄바꿈 없는 공백)
  ax: 'SKT\u00a0A.X-K2',
  exaone: 'LG\u00a0K-EXAONE',
  embedding: 'Upstage\u00a0Embedding',
};

/** 가운뎃점은 앞말에 붙여 줄 끝에 남긴다 — 줄 머리에 '·' 가 오지 않게. */
const keepDots = (text: string) => text.replaceAll(' · ', '\u00a0· ');

const PIPELINE = [
  {
    en: 'Capture',
    ko: '수집',
    where: '브라우저 · Chrome 확장',
    // extension/lib/events · lib/sync · entrypoints/content.ts
    items: [
      ['방문·체류 기록', '탭 이동과 유휴까지. 사용자가 켤 때만 수집'],
      ['본문 추출', 'Readability. 민감한 도메인은 본문 제외'],
      ['로컬 큐', 'IndexedDB에 쌓고 네 가지 시점에 배치 전송'],
    ],
  },
  {
    en: 'Understand',
    ko: '이해',
    where: '서버 배치 · FastAPI',
    // backend/app/services/event_filter · noise_filter · grouper · subclusterer
    items: [
      ['정리', '추적 파라미터 제거 · 중복 병합 · 스침 방문은 LLM 전에 제외'],
      ['시간 그룹', '30분 공백으로 나눈다'],
      ['주제 선분리', '임베딩 평균 연결 클러스터링(코사인 0.31)'],
    ],
  },
  {
    en: 'Organize',
    ko: '정리',
    where: 'LLM · PostgreSQL · Qdrant',
    // backend/app/services/intent_analyzer · session_updater · embedding_sync
    items: [
      ['의도 판단', `후보 세션에 append · create · hold · discard (${MODELS.exaone})`],
      ['요약', `제목 · 요약 · 다음 할 일 (${MODELS.ax})`],
      ['색인', '요약을 4,096차원 벡터로 Qdrant에'],
    ],
  },
  {
    en: 'Retrieve',
    ko: '찾기',
    where: '검색 · Ask · 복원',
    // backend/app/api/search.py · services/ask_service.py · newtab/lib/restore.ts
    items: [
      ['의미 검색', '질문 벡터로 Qdrant 코사인 검색(임계 0.28) · 선택적 리랭킹'],
      ['권한 확인', '개인·팀 범위를 읽는 SQL 안에서 다시 판정'],
      ['답과 복원', 'Ask 근거 답변(스트리밍) · 탭으로 세션 복원'],
    ],
  },
];

// 전면은 지연·규모에 집중한다. 골든/holdout 품질 전체는 metrics.json과 README에 보존한다.
const FEATURED_METRICS = METRICS.metrics.filter((metric) => ['A', 'B', 'D'].includes(metric.code));

export function TechBanner() {
  return (
    <BannerFrame step={3} number="03" label="현수막 — 03 TECHNOLOGY">
      <section className="ex-tech__intro">
        <h1 className="ex-tech__title">
          How Orbit
          <br />
          Remembers<span>.</span>
        </h1>
        <p className="ex-tech__sub">탐색의 흔적을 구조화된 기억으로.</p>
      </section>

      <div className="ex-tech__body">
        <section className="ex-pipe" aria-label="시스템 파이프라인">
          <div className="ex-pipe__line" aria-hidden>
            <i />
          </div>
          {PIPELINE.map((stage, index) => (
            <div className="ex-pipe__stage" key={stage.en}>
              <span className="ex-pipe__node" aria-hidden>
                <StageGlyph stage={index} />
              </span>
              <span className="ex-pipe__no">{String(index + 1).padStart(2, '0')}</span>
              <h2 className="ex-pipe__en">{stage.en}</h2>
              <p className="ex-pipe__ko">{stage.ko}</p>
              <p className="ex-pipe__where">{stage.where}</p>
              <ul className="ex-pipe__items">
                {stage.items.map(([head, text]) => (
                  <li key={head}>
                    <b>{head}</b>
                    <span>{keepDots(text)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="ex-pipe__runtime">
            <span>
              <b>BROWSER</b>
              {keepDots('Chrome 확장 MV3 · React · IndexedDB')}
            </span>
            <span>
              <b>SERVER</b>
              {keepDots('FastAPI · PostgreSQL · Qdrant')}
            </span>
            <span>
              <b>KOREAN AI</b>
              {keepDots(`${MODELS.ax} ↔ ${MODELS.exaone} 상호 폴백 · ${MODELS.embedding}`)}
            </span>
          </div>
        </section>

        <section className="ex-perf" aria-label="성능 지표">
          <div className="ex-section-head">
            <h2>Measured Performance</h2>
            <span className={`ex-status${METRICS.updated ? ' is-done' : ''}`}>{METRICS.updated ? `측정 ${METRICS.updated}` : METRICS.status}</span>
          </div>
          {FEATURED_METRICS.map((metric) => (
            <MetricRow key={metric.code} metric={metric} />
          ))}
        </section>

        <section className="ex-refusal" aria-label="이번 소규모 시험의 기록 없음 판별 비교">
          <div className="ex-section-head">
            <h2>Know What Is Missing.</h2>
            <span className="ex-status">소규모 고정 질문 시험</span>
          </div>
          <div className="ex-refusal__hero">
            <div>
              <p className="ex-refusal__eyebrow">기록 없음 판별 · 이번 시험</p>
              <h3>없는 기록은,<br />없다고 답합니다.</h3>
              <p className="ex-refusal__description">무관한 웹 페이지를 내 기록으로 제시하지 않았습니다.</p>
            </div>
            <div className="ex-refusal__score">
              <span>ORBIT</span>
              <strong>{REFUSAL_HIGHLIGHT.orbit.percent}<small>%</small></strong>
            </div>
          </div>
          <div className="ex-refusal__comparison">
            <div className="ex-refusal__bars" aria-label="같은 척도에서 기록 없음 판별 비율 비교">
              {[
                { name: 'Orbit', percent: REFUSAL_HIGHLIGHT.orbit.percent, orbit: true },
                { name: 'Comet', percent: REFUSAL_HIGHLIGHT.comet.percent, orbit: false },
              ].map((product) => (
                <div className={`ex-refusal__row${product.orbit ? ' is-orbit' : ''}`} key={product.name}>
                  <b>{product.name}</b>
                  <span className="ex-refusal__track" aria-hidden>
                    <i style={{ width: `${product.percent}%` }} />
                  </span>
                  <strong>{product.percent}%</strong>
                </div>
              ))}
            </div>
            <div className="ex-refusal__difference">
              <strong>+{REFUSAL_HIGHLIGHT.differencePoints}<small>%p</small></strong>
              <span>이번 시험의 Comet 대비 차이</span>
            </div>
          </div>
          <p className="ex-fineprint">
            {keepDots(
              '2026-10-20 자체 시험 · 사전 고정한 기록이 없는 두 질문·각 1회 결과. 전체 검색 정확도를 뜻하지 않습니다. 같은 공개 URL 26개 방문 · Orbit: Headless 확장, Comet: 로그인 시험. 실행 방식·수집 콘텐츠 차이 있음(Orbit 제주항공 403).',
            )}
          </p>
        </section>

      </div>
    </BannerFrame>
  );
}

/**
 * 단계마다 데이터가 어떤 모양이 되는지 — 흩어진 방문 → 시간으로 나뉜 점(색은 주제) → 세션 고리 → 찾은 점.
 * 1·2번 현수막의 흩어짐과 궤도를 기술의 말로 되풀이한다. 색은 세션 색 팔레트(lib/session-hue.ts).
 */
function StageGlyph({ stage }: { stage: number }) {
  const [coral, amber, green, teal] = SESSION_HUES;
  if (stage === 0) {
    const pages: [number, number, number][] = [[24, 30, -18], [52, 24, 12], [70, 40, -8], [32, 56, 24], [58, 62, -22], [44, 42, 6], [74, 66, 16], [20, 72, -6]];
    return (
      <svg viewBox="0 0 96 96">
        {pages.map(([x, y, angle]) => (
          <rect key={`${x}-${y}`} x={x - 6} y={y - 7.5} width="12" height="15" rx="2" transform={`rotate(${angle} ${x} ${y})`} className="ex-glyph__page" />
        ))}
      </svg>
    );
  }
  if (stage === 1) {
    const dots: [number, string][] = [[16, green], [24, green], [32, amber], [40, green], [60, teal], [68, teal], [76, teal]];
    return (
      <svg viewBox="0 0 96 96">
        <line x1="10" y1="48" x2="86" y2="48" className="ex-glyph__axis" />
        <line x1="50" y1="38" x2="50" y2="58" className="ex-glyph__gap" />
        {dots.map(([x, color]) => (
          <circle key={x} cx={x} cy="48" r="4.2" fill={color} />
        ))}
      </svg>
    );
  }
  const ring = Array.from({ length: 7 }, (_, index) => {
    const angle = (index / 7) * Math.PI * 2 + 0.4;
    return [48 + Math.cos(angle) * 30, 50 + Math.sin(angle) * 13] as const;
  });
  return (
    <svg viewBox="0 0 96 96">
      <ellipse cx="48" cy="50" rx="30" ry="13" className="ex-glyph__ring" style={{ stroke: green }} transform="rotate(-14 48 50)" />
      <circle cx="48" cy="50" r="7" fill={green} opacity="0.85" />
      {ring.map(([x, y], index) => (
        <circle
          key={index}
          cx={x}
          cy={y}
          r={stage === 3 && index === 1 ? 6 : 3.6}
          transform="rotate(-14 48 50)"
          fill={stage === 3 && index === 1 ? coral : green}
          className={stage === 3 && index === 1 ? 'ex-glyph__found' : undefined}
        />
      ))}
      {stage === 3 && (
        <g className="ex-glyph__lens">
          <circle cx="66" cy="30" r="9" />
          <line x1="72.5" y1="36.5" x2="80" y2="44" />
        </g>
      )}
    </svg>
  );
}

function MetricRow({ metric }: { metric: Metric }) {
  const measuredAny = metric.values.some((value) => isMeasured(value.status, value.value));
  return (
    <article className={`ex-metric${measuredAny ? ' is-measured' : ''}`}>
      <div className="ex-metric__name">
        <b>{metric.code}</b>
        <div>
          <h3>{metric.title}</h3>
          <p className="ex-metric__ko">{metric.ko}</p>
          <p className="ex-metric__scope">{measuredAny && metric.note ? metric.note : metric.scope}</p>
        </div>
      </div>
      <div className="ex-metric__values">
        {metric.values.map((value) => {
          const shown = displayMeasure(value);
          return (
            <div key={value.label} className={shown.measured ? 'is-measured' : 'is-pending'}>
              <span className="ex-metric__label">{value.label}</span>
              <span className="ex-metric__value">
                {shown.text}
                {shown.measured && <small>{shown.unit}</small>}
              </span>
            </div>
          );
        })}
        {metric.code === 'D' && <ScaleChart />}
      </div>
    </article>
  );
}

/** D — 저장된 세션 수에 따른 지연. 실측한 점만 그린다. 없으면 빈 축과 '측정 진행 중'. */
function ScaleChart() {
  const points = METRICS.scaling.filter((point) => isMeasured(point.status, point.p95 ?? point.p50));
  const width = 250;
  const height = 74;
  const max = Math.max(1, ...points.map((point) => point.p95 ?? point.p50 ?? 0));
  const xs = points.map((point) => point.sessions);
  const [minX, maxX] = [Math.min(...xs, 100), Math.max(...xs, 10_000)];
  const x = (sessions: number) => 8 + ((Math.log10(sessions) - Math.log10(minX)) / Math.max(0.0001, Math.log10(maxX) - Math.log10(minX))) * (width - 16);
  const y = (ms: number) => height - 16 - (ms / max) * (height - 28);
  return (
    <svg className="ex-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="저장된 세션 수에 따른 검색 지연">
      <line x1="8" y1={height - 16} x2={width - 8} y2={height - 16} />
      <line x1="8" y1="6" x2="8" y2={height - 16} />
      <text x={width - 8} y={height - 3} textAnchor="end">
        저장된 세션 수 →
      </text>
      {points.length === 0 ? (
        <text className="ex-chart__pending" x={width / 2} y={height / 2 - 2} textAnchor="middle">
          측정 진행 중
        </text>
      ) : (
        <>
          <polyline points={points.map((point) => `${x(point.sessions)},${y(point.p95 ?? point.p50 ?? 0)}`).join(' ')} />
          {points.map((point) => (
            <circle key={point.sessions} cx={x(point.sessions)} cy={y(point.p95 ?? point.p50 ?? 0)} r="3.5" />
          ))}
        </>
      )}
    </svg>
  );
}
