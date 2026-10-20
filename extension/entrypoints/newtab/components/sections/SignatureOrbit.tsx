import { useId } from 'react';
import { LivingPlanet } from '../planet/LivingPlanet';

/** 원래 홈 그래픽의 틀 — 208px 에 viewBox 240. 구 지름도 원래 행성(반지름 24)과 같다. */
const FRAME = 208;
const VIEW = 240;
const PLANET_DIAMETER = (48 * FRAME) / VIEW;

/** 궤도 두 줄. 안쪽은 구 앞을 가로지르고, 바깥 줄에는 작은 위성 하나가 천천히 돈다. */
const INNER = { rx: 56, ry: 16 };
const OUTER = { rx: 92, ry: 26 };
const MOON_SECONDS = 36;
/** 앞·뒤 경계에서 선이 끊기지 않도록 겹쳐 지우는 폭 */
const SEAM = 6;

const ellipsePath = ({ rx, ry }: { rx: number; ry: number }) =>
  `M ${rx} 0 A ${rx} ${ry} 0 1 1 ${-rx} 0 A ${rx} ${ry} 0 1 1 ${rx} 0`;

/**
 * 궤도의 앞쪽 반이나 뒤쪽 반만 그린 층. 뒤쪽은 구 밑에, 앞쪽은 구 위에 겹쳐야 입체로 읽힌다.
 * 기울어진 좌표계 안에서 위·아래 반을 마스크로 나눠, 위성이 옆을 돌아 나올 때 층이 바뀌어도
 * 이어져 보인다.
 */
function RingLayer({ layer }: { layer: 'back' | 'front' }) {
  const id = useId();
  const front = layer === 'front';
  return (
    <svg
      className={`signature-orbit__rings signature-orbit__rings--${layer}`}
      viewBox={`${-VIEW / 2} ${-VIEW / 2} ${VIEW} ${VIEW}`}
      width={FRAME}
      height={FRAME}
      aria-hidden
    >
      <defs>
        <linearGradient id={`${id}-fade`} gradientUnits="userSpaceOnUse" x1="0" y1={-SEAM} x2="0" y2={SEAM}>
          <stop offset="0" stopColor={front ? '#000' : '#fff'} />
          <stop offset="1" stopColor={front ? '#fff' : '#000'} />
        </linearGradient>
        <mask id={`${id}-half`} maskUnits="userSpaceOnUse" x={-VIEW} y={-VIEW} width={VIEW * 2} height={VIEW * 2}>
          <rect x={-VIEW} y={-VIEW} width={VIEW * 2} height={VIEW * 2} fill={`url(#${id}-fade)`} />
        </mask>
      </defs>
      <g className="signature-orbit__tilt">
        <g mask={`url(#${id}-half)`}>
          <ellipse className="so-ring so-ring--inner" rx={INNER.rx} ry={INNER.ry} />
          <ellipse className="so-ring so-ring--outer" rx={OUTER.rx} ry={OUTER.ry} />
          <circle className="so-moon" r="3">
            <animateMotion dur={`${MOON_SECONDS}s`} repeatCount="indefinite" path={ellipsePath(OUTER)} />
          </circle>
        </g>
      </g>
    </svg>
  );
}

/**
 * 홈의 시그니처 그래픽 — 레퍼런스의 구와 그 둘레의 가는 궤도.
 * 누르면 아틀라스 전체를 둘러보러 간다(OrbitHero 가 동작을 넘긴다).
 */
export function SignatureOrbit({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="signature-orbit" title="대시보드 열기" onClick={onOpen}>
      <div className="signature-orbit__stage">
        <RingLayer layer="back" />
        <div className="signature-orbit__planet">
          <LivingPlanet size={PLANET_DIAMETER} />
        </div>
        <RingLayer layer="front" />
      </div>
    </div>
  );
}
