import { useId } from 'react';
import { LivingPlanet } from '../planet/LivingPlanet';

/**
 * 궤도 세 줄(가로·세로 반지름). 안쪽은 두 겹 실선으로 행성 앞을 가로지르고,
 * 가운데는 입자가 흐르는 띠, 바깥은 아주 옅은 한 줄이다 — 선 수를 줄여야 가볍다.
 */
const RINGS = [
  { rx: 80, ry: 20, kind: 'double' },
  { rx: 116, ry: 30, kind: 'dust' },
  { rx: 152, ry: 40, kind: 'faint' },
] as const;
const DUST = RINGS[1];
/** 입자의 출발 위치(한 바퀴 중 비율). 고르게 두지 않아야 기계적으로 보이지 않는다. */
const PARTICLES = [0, 0.11, 0.27, 0.42, 0.55, 0.71, 0.86];
const DUST_SECONDS = 26;
/** 앞·뒤 경계에서 선이 끊기지 않도록 겹쳐 지우는 폭 */
const SEAM = 7;

const ellipsePath = ({ rx, ry }: { rx: number; ry: number }) =>
  `M ${rx} 0 A ${rx} ${ry} 0 1 1 ${-rx} 0 A ${rx} ${ry} 0 1 1 ${rx} 0`;

/**
 * 궤도의 앞쪽 반이나 뒤쪽 반만 그린 층.
 *
 * 행성 뒤로 지나가는 뒤쪽은 행성 밑에, 앞쪽은 행성 위에 겹쳐야 입체로 읽힌다.
 * 두 층에 같은 궤도와 입자를 그리고 기울어진 좌표계 안에서 위·아래 반을 마스크로
 * 나눈다 — 입자가 옆을 돌아 나올 때 층이 바뀌어도 위치가 이어진다.
 */
function RingLayer({ layer }: { layer: 'back' | 'front' }) {
  const id = useId();
  const front = layer === 'front';
  return (
    <svg
      className={`signature-orbit__rings signature-orbit__rings--${layer}`}
      viewBox="-172 -108 344 216"
      width="344"
      height="216"
      aria-hidden
    >
      <defs>
        <linearGradient id={`${id}-fade`} gradientUnits="userSpaceOnUse" x1="0" y1={-SEAM} x2="0" y2={SEAM}>
          <stop offset="0" stopColor={front ? '#000' : '#fff'} />
          <stop offset="1" stopColor={front ? '#fff' : '#000'} />
        </linearGradient>
        <mask id={`${id}-half`} maskUnits="userSpaceOnUse" x="-200" y="-140" width="400" height="280">
          <rect x="-200" y="-140" width="400" height="280" fill={`url(#${id}-fade)`} />
        </mask>
      </defs>

      <g className="signature-orbit__tilt">
        <g mask={`url(#${id}-half)`}>
          <ellipse className="so-haze" rx={DUST.rx} ry={DUST.ry} />
          {RINGS.map((ring) => (
            <g key={ring.rx} className={`so-orbit so-orbit--${ring.kind}`}>
              <ellipse className="so-ring so-ring--tint" rx={ring.rx} ry={ring.ry} />
              {ring.kind === 'double' && (
                <ellipse className="so-ring so-ring--light" rx={ring.rx - 2.4} ry={ring.ry - 1.2} />
              )}
            </g>
          ))}
          <g className="so-dust">
            {PARTICLES.map((start, index) => (
              <circle key={start} r={index % 3 === 0 ? 2.3 : 1.6}>
                <animateMotion
                  dur={`${DUST_SECONDS}s`}
                  begin={`${-start * DUST_SECONDS}s`}
                  repeatCount="indefinite"
                  path={ellipsePath(DUST)}
                />
              </circle>
            ))}
          </g>
        </g>
      </g>
    </svg>
  );
}

/**
 * 홈의 시그니처 그래픽 — 말랑한 행성과 그 둘레의 실선 궤도.
 * 누르면 아틀라스 전체를 둘러보러 간다(OrbitHero 가 동작을 넘긴다).
 */
export function SignatureOrbit({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="signature-orbit" title="대시보드 열기" onClick={onOpen}>
      <div className="signature-orbit__stage">
        <RingLayer layer="back" />
        <LivingPlanet className="signature-orbit__planet" size={104} />
        <RingLayer layer="front" />
      </div>
    </div>
  );
}
