/**
 * 3번 현수막 — TECHNOLOGY. 파이프라인은 지금 코드에서 확인한 것만 쓴다(각 단계의 source).
 * 성능 숫자는 metrics.json, 기능 비교는 competitor_matrix.csv 에서만 온다. 실측이 아니면 숫자를 그리지 않는다.
 */
import matrixCsv from './competitor_matrix.csv?raw';
import { SESSION_HUES } from '../../lib/session-hue';
import { BannerFrame } from './frame';
import { METRICS, buildMatrix, displayMeasure, isMeasured, parseCsv, type Metric } from './metrics';

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

const MATRIX = buildMatrix(parseCsv(matrixCsv));
const GROUPS = [
  { documentOnly: false, label: '직접 시험 — 같은 공개 웹페이지 기록으로 묻고 찾았는지 본다' },
  { documentOnly: true, label: '† 공식 문서 기준 — 직접 시험하지 않았다' },
];

export function TechBanner() {
  return (
    <BannerFrame index={2} label="현수막 3 — TECHNOLOGY">
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
          {METRICS.metrics.map((metric) => (
            <MetricRow key={metric.code} metric={metric} />
          ))}
          <div className="ex-method" aria-label="측정 조건">
            {METRICS.method.map((row) => (
              <div key={row.label}>
                <span>{row.label}</span>
                <b>{row.value ?? 'TBD'}</b>
              </div>
            ))}
          </div>
        </section>

        <section className="ex-compare" aria-label="과거 탐색 검색 기능 비교">
          <div className="ex-section-head">
            <h2>Past Browsing Search, Compared</h2>
            <span className="ex-status">같은 공개 웹페이지 기록으로 시험</span>
          </div>
          <table className="ex-table">
            <thead>
              <tr>
                <th />
                {MATRIX.capabilities.map((capability) => (
                  <th key={capability}>{capability}</th>
                ))}
              </tr>
            </thead>
            {/* 직접 시험한 제품과 공식 문서로만 판정한 제품을 묶음으로 가른다(데이터의 basis 로 정해진다) */}
            {GROUPS.map((group) => {
              const products = MATRIX.products.filter((product) => product.documentOnly === group.documentOnly);
              if (products.length === 0) return null;
              return (
                <tbody key={group.label} className={group.documentOnly ? 'is-docs' : undefined}>
                  <tr className="ex-table__group">
                    <th colSpan={MATRIX.capabilities.length + 1}>{group.label}</th>
                  </tr>
                  {products.map((product) => (
                    <tr key={product.name} className={product.name === 'Orbit' ? 'is-orbit' : undefined}>
                      <th>
                        <ProductName name={product.name} />
                        {product.documentOnly && <sup>†</sup>}
                      </th>
                      {MATRIX.capabilities.map((capability) => {
                        const cell = MATRIX.cell(product.name, capability);
                        return (
                          <td key={capability} className={`is-${cell.kind}${cell.documentOnly ? ' is-docs' : ''}`}>
                            <i className="ex-mark" aria-hidden />
                            {cell.text}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              );
            })}
          </table>
          <p className="ex-fineprint">
            {keepDots(
              '직접 시험 2026-10-20 · 빈 브라우저 프로필에 공개 웹페이지 26개를 방문한 뒤 같은 질문 8개(기록 있음 6 · 없음 2)를 질문마다 한 번씩 · Comet은 로그인한 에이전트 모드 기준이며 찾은 1건은 답까지 5분 넘게 걸렸다 · Chrome은 한국의 시험 계정에서 Gemini 기록 검색이 제공되지 않아 기본 기록 검색으로 시험 · 제품마다 조건이 달라 속도는 비교하지 않는다.',
            )}
          </p>
        </section>

        <section className="ex-slots" aria-label="행사와 팀">
          <div className="ex-slot">
            <span>AI Rookie 2026 결선</span>
            <small>행사 로고 자리 — 공식 파일을 받으면 넣는다</small>
          </div>
          <div className="ex-slot">
            <span>Orbit 팀</span>
            <small>팀 로고·이름 자리 — 자료 요청 중</small>
          </div>
          <div className="ex-slot ex-slot--qr">
            <span>QR</span>
            <small>체험 링크</small>
          </div>
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

/** "Google Chrome (Gemini 기록 검색)" — 괄호 안은 작은 둘째 줄로. */
function ProductName({ name }: { name: string }) {
  const [, main, sub] = name.match(/^(.*?)\s*\((.+)\)$/) ?? [null, name, null];
  return (
    <span className="ex-table__product">
      {main}
      {sub && <small>{sub}</small>}
    </span>
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
