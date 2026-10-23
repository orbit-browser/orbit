/**
 * 5번 현수막 — TECHNOLOGY. 파이프라인은 지금 코드에서 확인한 것만 쓴다(각 단계의 source).
 * 서버 성능은 metrics.json, 이번 UI 시험의 비율은 원본 CSV에서 계산한다.
 */
import { SESSION_HUES } from '../../lib/session-hue';
import { BannerFrame } from './frame';
import { METRICS, displayMeasure, isMeasured, type Metric } from './metrics';
import { PROVEN } from './trial-highlights';

/**
 * 지금 설정의 모델(DecisionLog 2026-10-23). 의도·탭 묶기는 A.X-K2 → KT 믿:음, 요약·리랭크는 A.X-K2 → K-EXAONE,
 * Ask 답변은 K-EXAONE → A.X-K2다(backend/app/ai/llm.py) — 바뀌면 여기만 고친다.
 */
export const MODELS = {
  // 모델 이름은 줄에서 갈라지지 않게 — 공백은 줄바꿈 없는 공백, 하이픈·쌍점 뒤는 단어 결합자(U+2060).
  // 크롬은 하이픈 뒤와 쌍점 뒤 한글('믿:' | '음')에서도 줄을 바꾼다.
  ax: 'SKT\u00a0A.X-\u2060K2',
  exaone: 'LG\u00a0K-\u2060EXAONE',
  kt: 'KT\u00a0믿:\u2060음',
  embedding: 'Upstage\u00a0Embedding',
};

/** 가운뎃점은 앞말에 붙여 줄 끝에 남긴다 — 줄 머리에 '·' 가 오지 않게. */
const keepDots = (text: string) => text.replaceAll(' · ', '\u00a0· ');

export const PIPELINE = [
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
      ['의도 판단', `후보 세션에 append · create · hold · discard (${MODELS.ax})`],
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
      ['답과 복원', `Ask 근거 답변(스트리밍, ${MODELS.exaone}) · 탭으로 세션 복원`],
    ],
  },
];

/** 시험으로 확인한 숫자 세 개 — 기술 현수막과 실제 화면 시안(?variant=span)이 같은 숫자·같은 말을 쓴다. */
export const PROVEN_STATS = [
  {
    value: PROVEN.refusal.orbit.percent,
    unit: '%',
    title: '기록에 없는 건 없다고 답했습니다',
    detail: keepDots(`같은 조건 시험 ${PROVEN.refusal.orbit.total}번 중 ${PROVEN.refusal.orbit.hit}번 · Comet ${PROVEN.refusal.comet.percent}%`),
  },
  {
    value: PROVEN.restorePrecision.orbit.percent,
    unit: '%',
    title: '다시 열었을 때 엉뚱한 탭은 없었습니다',
    detail: keepDots(`목표 9개 중 ${PROVEN.restorePrecision.orbit.total}개를 열었고 열린 페이지는 모두 그 작업 · Comet은 연 ${PROVEN.restorePrecision.comet.total}개 중 ${PROVEN.restorePrecision.comet.hit}개(${PROVEN.restorePrecision.comet.percent}%)`),
  },
  {
    value: PROVEN.teamIsolation.leaks,
    unit: '건',
    title: '공유 안 한 세션이 팀원에게 보인 경우',
    detail: keepDots(`계정 둘 격리 서버 시험 · 화면·API ${PROVEN.teamIsolation.paths}가지 경로, 응답 ${PROVEN.teamIsolation.responses}개에서 0건`),
  },
];

export const PROVEN_NOTE = keepDots(
  '직접 시험 · 빈 브라우저에 같은 공개 웹페이지 26개를 방문하고 같은 질문을 한 번씩(Orbit 2026-10-22 헤드리스 확장, Comet 2026-10-20 로그인한 에이전트·검색 모드) · 다시 열기는 찾은 작업의 페이지를 한 번에 열었을 때 그 작업의 페이지 비율로, Orbit은 세션 혼입 결함을 고친 뒤 같은 시험으로 다시 잰 값(Comet은 작업 1개) · 팀 시험은 2026-10-22 격리 서버에서 계정 둘로 공유·해제·내보내기 · 표본이 작아 전체 정확도를 뜻하지 않음.',
);

export function ProvenStat({ stat }: { stat: (typeof PROVEN_STATS)[number] }) {
  return (
    <article className="ex-proven__stat">
      <strong>
        {stat.value}
        <small>{stat.unit}</small>
      </strong>
      <h3>{stat.title}</h3>
      <p>{stat.detail}</p>
    </article>
  );
}

// 전면은 지연·규모에 집중한다. 골든/holdout 품질 전체는 metrics.json과 README에 보존한다.
// C(1만 세션 골든 정답률)는 골든 질문으로 고친 뒤의 값이고 새 표현 질문에서는 100%가 아니라 앞면에서 뺀다.
const FEATURED_METRICS = METRICS.metrics.filter((metric) => ['A', 'B'].includes(metric.code));

export function TechBanner() {
  return (
    <BannerFrame step={3} label="현수막 — TECHNOLOGY">
      <section className="ex-tech__intro">
        <h1 className="ex-tech__title">
          How Orbit
          <br />
          Remembers<span>.</span>
        </h1>
        <p className="ex-tech__sub">페이지를 연 순간부터 다시 찾을 때까지</p>
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
              {keepDots(`${MODELS.ax} · ${MODELS.exaone} · ${MODELS.kt} 폴백 · ${MODELS.embedding}`)}
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

        <section className="ex-proven" aria-label="시험으로 확인한 숫자">
          <div className="ex-section-head">
            {/* 질문 두 개·작업 하나의 작은 시험이라 "Proven" 같은 센 말은 쓰지 않는다 — 각주의 "전체 정확도를 뜻하지 않음"과 맞춘다 */}
            <h2>Test Results</h2>
            <span className="ex-status">직접 시험</span>
          </div>
          <div className="ex-proven__grid">
            {PROVEN_STATS.map((stat) => (
              <ProvenStat key={stat.title} stat={stat} />
            ))}
          </div>
          <p className="ex-fineprint">{PROVEN_NOTE}</p>
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
      </div>
    </article>
  );
}

