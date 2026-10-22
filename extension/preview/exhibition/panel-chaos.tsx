/**
 * 1번 현수막 — CHAOS. 브라우저 창들이 종이처럼 공중에 흩날리고, 오른쪽 끝(2번 현수막 쪽)으로 빠져나간다.
 *
 * 한 카메라(perspective 하나)로 비추는 구름이다. 왼쪽 아래가 가깝고(크고 앞으로 흐림) 오른쪽 위가 멀다
 * (작고 옅음). 초점은 가운데 깊이에 있다. 빛은 왼쪽 위에서 하나라 카드 면의 기울기마다 밝기가 다르다.
 * 제주 세션의 페이지는 2번 갤러리와 같은 높이(1,080mm)에서 가지런해지며 오른쪽으로 나간다 — 2번에서 다시 만난다.
 * 카드끼리 3D 로 꿰뚫지 않게 preserve-3d 대신 깊이 순 z-index 로 쌓는다.
 */
import { pageByUrl } from './content';
import { BannerFrame, BrowserCard } from './frame';

const CAMERA = { perspective: 2400, x: 720, y: 1080 };
const LIGHT = normalize([-0.45, -0.65, 0.62]);

/**
 * 흩어지는 페이지 — 앞에 둘수록 가까운 겹(크게)에 놓인다. 사진·색이 많은 페이지를 앞에, 어두운 문서는 가운데에.
 * 화면을 뺀 페이지(content.ts EXCLUDED_SHOTS)는 회색 칸이 되므로 여기 넣지 않는다.
 */
export const CLOUD = [
  // 앞 겹 — 사진과 색
  'https://blog.naver.com/osaka_eat/2231',
  'https://www.google.com/maps/place/Dotonbori',
  'https://blog.naver.com/fukuoka/2231',
  'https://qdrant.tech/benchmarks/',
  'https://blog.naver.com/gadget/2231',
  'https://react.dev/reference/react/useOptimistic',
  'https://blog.naver.com/toss_im3/2231',
  'https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events',
  // 가운데 — 글 문서
  'https://github.com/sqlalchemy/sqlalchemy/discussions/9312',
  'https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle',
  'https://platform.openai.com/docs/guides/structured-outputs',
  'https://exam.toeic.co.kr/receipt/examSchList.php',
  'https://www.khug.or.kr/hug/web/ig/dr/igdr000001.jsp',
  'https://github.com/qdrant/qdrant/discussions/2416',
  'https://github.com/pgvector/pgvector',
  'https://qdrant.tech/documentation/concepts/filtering/',
  // 뒤 겹 — 어두운 문서와 작은 것
  'https://github.com/GoogleChrome/chrome-extensions-samples',
  'https://qdrant.tech/documentation/concepts/indexing/',
  'https://developer.chrome.com/docs/extensions/reference/api/alarms',
  'https://velog.io/@vector/qdrant-filter',
];

/** 오른쪽 끝으로 빠져나가는 제주 세션 — ORBIT 갤러리와 같은 높이(≈1,080mm), 갤러리와 같은 페이지. */
export const EXIT = [
  'https://www.diningcode.com/list.dc?query=애월카페',
  'https://www.weather.go.kr/w/index.do',
  'https://blog.naver.com/jejutrip/223101',
  'https://www.yanolja.com/search/서귀포',
  'https://flight.naver.com/flights/domestic/GMP-CJU',
];

/** 카드를 흩뿌리는 칸(보이는 자리, mm) — 제목 아래부터 아래 글 위까지 */
const AREA = { left: -40, right: 1000, top: 700, bottom: 1790 };
/** 오른쪽으로 빠져나가는 길 — 2번 갤러리 가운데 높이 */
const LANE = { from: 400, y: 1080, half: 160 };
/** 길 폭의 절반 — 왼쪽(큰 카드)에서 넓고 오른쪽 끝으로 갈수록 좁다 */
const laneHalf = (x: number) => LANE.half - 70 * Math.min(1, Math.max(0, (x - LANE.from) / 600));

interface Spec {
  url: string;
  /** 보이는 가운데(현수막 mm) */
  ax: number;
  ay: number;
  /** 보이는 폭(mm) */
  aw: number;
  /** 깊이(+ 가까움, − 멂) */
  z: number;
  rx: number;
  ry: number;
  rz: number;
  /** 세로 종이(1:1.3) 또는 가로 창(1:0.66) */
  tall: boolean;
  /** 2번으로 나가는 행렬 — 멀어져도 초점을 잃지 않는다 */
  focus?: boolean;
}

function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 구름처럼 흩뿌린다 — 후보 여러 개 중 이미 놓은 카드에서 가장 먼 자리를 고른다(고르게 퍼지되 격자가 아니다).
 * 깊이는 자리에서 정한다: 왼쪽 아래일수록 가깝고 오른쪽 위일수록 멀다(+ 잡음). 씨앗이 같으면 늘 같은 배치.
 */
function layout(): Spec[] {
  const random = mulberry32(20261020);
  const jitter = (amount: number) => (random() - 0.5) * 2 * amount;
  const placed: [number, number][] = [];
  const pick = (): [number, number] => {
    let best: [number, number] = [0, 0];
    let bestGap = -1;
    for (let candidate = 0; candidate < 24; candidate += 1) {
      const point: [number, number] = [AREA.left + random() * (AREA.right - AREA.left), AREA.top + random() * (AREA.bottom - AREA.top)];
      // 오른쪽으로 빠져나가는 길(제주 세션)은 비워 둔다
      if (point[0] > LANE.from && Math.abs(point[1] - LANE.y) < laneHalf(point[0])) continue;
      const gap = Math.min(Infinity, ...placed.map(([x, y]) => Math.hypot(x - point[0], (y - point[1]) * 1.15)));
      if (gap > bestGap) [best, bestGap] = [point, gap];
    }
    placed.push(best);
    return best;
  };
  // 자리를 먼저 뿌리고 가까운 자리부터 목록 순서로 페이지를 놓는다 — 사진·색이 많은 페이지가 앞 겹에 크게 나온다
  const spots = CLOUD.map(() => {
    const [ax, ay] = pick();
    const across = (ax - AREA.left) / (AREA.right - AREA.left);
    const down = (ay - AREA.top) / (AREA.bottom - AREA.top);
    return { ax, ay, across, nearness: Math.min(1, Math.max(0, 0.55 * (1 - across) + 0.45 * down + jitter(0.28))) };
  }).sort((a, b) => b.nearness - a.nearness);
  const cloud = CLOUD.map((url, index): Spec => {
    const { ax, ay, across, nearness } = spots[index];
    const wild = 0.45 + 0.55 * nearness;
    return {
      url,
      ax,
      ay,
      aw: (92 + 290 * nearness ** 1.5) * (0.85 + random() * 0.3),
      z: -1700 + 2150 * nearness,
      rx: jitter(58 * wild),
      ry: jitter(70 * wild) - 14 * across,
      rz: jitter(42 * wild),
      tall: random() > 0.4,
    };
  });
  // 흐트러진 것에서 가지런한 것으로 — 끝으로 갈수록 덜 뒤집히고, 작아지고, 2번 갤러리 왼쪽 카드처럼 돌아선다
  const exit = EXIT.map((url, index): Spec => {
    const t = index / (EXIT.length - 1);
    const settle = 1 - t;
    return {
      url,
      ax: LANE.from + 80 + (1060 - LANE.from - 80) * t ** 0.85,
      ay: LANE.y - 46 * Math.sin(Math.PI * t) + jitter(20) * settle,
      aw: 235 - 115 * t,
      z: -140 - 1000 * t,
      rx: jitter(22 * settle),
      ry: -10 - 32 * t + jitter(12 * settle),
      rz: jitter(20 * settle) - 3 * t,
      tall: true,
      focus: true,
    };
  });
  return [...cloud.map(keepLaneClear), ...exit].map(keepClear);
}

/** 구름 카드의 몸체가 길에 걸치면 위나 아래로 비켜 놓는다 — 행렬이 바탕 위에 또렷이 보이게. */
function keepLaneClear(spec: Spec): Spec {
  const half = (spec.aw * (spec.tall ? 1.3 : 0.66)) / 2;
  if (spec.ax + spec.aw / 2 < LANE.from) return spec;
  const clearance = laneHalf(spec.ax) + half;
  if (Math.abs(spec.ay - LANE.y) >= clearance) return spec;
  return { ...spec, ay: spec.ay < LANE.y ? LANE.y - clearance : LANE.y + clearance };
}

/** 제목과 아래 글을 가리지 않게 — 카드가 글 영역에 걸치면 비켜 놓는다. */
function keepClear(spec: Spec): Spec {
  const height = spec.aw * (spec.tall ? 1.3 : 0.66);
  let { ay } = spec;
  // 아래는 장면이 바탕색으로 녹아드니(.ex-chaos__fade) 가운데만 글 위에 둔다
  ay = Math.min(ay, 1800 - height / 2);
  // 제목 글자 덩어리(왼쪽 위 690 × 720)와 겹치는 카드는 아래로
  if (spec.ax - spec.aw / 2 < 690 && ay - height / 2 < 720) ay = 720 + height / 2;
  return { ...spec, ay };
}

function normalize([x, y, z]: number[]): [number, number, number] {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** rotateZ·rotateY·rotateX(오른쪽부터 적용) 뒤의 앞면 방향 — 빛과의 각도로 밝기를 정한다. */
function facing(rx: number, ry: number, rz: number): [number, number, number] {
  const [a, b, c] = [rad(rx), rad(ry), rad(rz)];
  const n = [Math.sin(b) * Math.cos(a), -Math.sin(a), Math.cos(a) * Math.cos(b)];
  return [Math.cos(c) * n[0] - Math.sin(c) * n[1], Math.sin(c) * n[0] + Math.cos(c) * n[1], n[2]];
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const CARDS = layout().sort((a, b) => a.z - b.z);

export function ChaosBanner() {
  return (
    <BannerFrame step={1} label="현수막 — CHAOS">
      <div className="ex-chaos__scene" style={{ perspective: `${CAMERA.perspective}px`, perspectiveOrigin: `${CAMERA.x}px ${CAMERA.y}px` }} aria-hidden>
        {CARDS.map((spec, order) => {
          const page = pageByUrl(spec.url);
          if (!page) return null;
          // 보이는 자리·폭에서 3D 자리·폭으로 — 원근이 줄인 만큼 되돌린다.
          const k = (CAMERA.perspective - spec.z) / CAMERA.perspective;
          const width = spec.aw * k;
          const height = width * (spec.tall ? 1.3 : 0.66);
          const x = CAMERA.x + (spec.ax - CAMERA.x) * k;
          const y = CAMERA.y + (spec.ay - CAMERA.y) * k;
          const light = Math.max(0, facing(spec.rx, spec.ry, spec.rz).reduce((sum, value, index) => sum + value * LIGHT[index], 0));
          // 초점은 가운데 깊이(z ≈ −100) — 더 가깝거나 멀면 흐려진다
          const blur = clamp(Math.abs(spec.z + 100) / 260 - 1, 0, spec.focus ? 0.8 : 6);
          const haze = clamp((-spec.z - 500) / 2600, 0, 0.5);
          // 밝기는 덮개로 — CSS filter 가 걸린 카드는 PDF 에서 72ppi 그림으로 굳는다. 초점이 맞은 카드는 filter 없이 둬 선명하게 인쇄한다
          const brightness = 0.86 + 0.2 * light;
          const shade = brightness < 1 ? `rgba(0, 0, 0, ${(1 - brightness).toFixed(3)})` : `rgba(255, 255, 255, ${(brightness - 1).toFixed(3)})`;
          const lift = clamp((spec.z + 1800) / 2400, 0, 1);
          return (
            <div
              key={spec.url}
              className="ex-chaos-card"
              style={{
                left: x - width / 2,
                top: y - height / 2,
                zIndex: order + 1,
                transform: `translateZ(${spec.z.toFixed(1)}px) rotateZ(${spec.rz.toFixed(1)}deg) rotateY(${spec.ry.toFixed(1)}deg) rotateX(${spec.rx.toFixed(1)}deg)`,
                filter: blur >= 0.05 ? `blur(${blur.toFixed(2)}px)` : undefined,
                ['--haze' as string]: haze.toFixed(3),
                ['--shade' as string]: shade,
                ['--lift' as string]: lift.toFixed(3),
                ['--float-delay' as string]: `${-((order * 1.7) % 9)}s`,
                ['--float-time' as string]: `${7 + (order % 5)}s`,
              }}
            >
              <div className="ex-chaos-card__float">
                <BrowserCard page={page} width={width} height={height} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="ex-chaos__fade" aria-hidden />

      <h1 className="ex-chaos__title">
        어제 봤던
        <br />그 페이지,
        <br />
        어디 갔지?
      </h1>

      <section className="ex-chaos__text">
        <p className="ex-chaos__lead">
          브라우저에는 기록이 남지만,
          <br />
          우리가 무엇을 찾고 있었는지는
          <br />
          쉽게 잊힙니다.
        </p>
        <ol className="ex-chaos__problems">
          <li>
            <b>맥락이 사라진다</b>
            <span>다시 돌아오면 어떤 탭을 왜 열었는지 기억나지 않습니다.</span>
          </li>
          <li>
            <b>닫은 탐색은 모으기 어렵다</b>
            <span>북마크는 저장한 것만 남깁니다. 닫은 탭과 흘려보낸 검색 경로는 흩어집니다.</span>
          </li>
          <li>
            <b>주소로는 흐름을 못 찾는다</b>
            <span>방문 기록은 주소와 제목의 목록이라, 무엇을 하던 중이었는지로는 찾기 어렵습니다.</span>
          </li>
        </ol>
      </section>

      <p className="ex-fineprint ex-chaos__fineprint">
        카드 속 화면: 공개 웹페이지를 로그인 없이 캡처(2026-10-22, 일부는 한 부분을 키움) · 탭 제목과 방문: 시연용 합성 데이터
      </p>
    </BannerFrame>
  );
}
