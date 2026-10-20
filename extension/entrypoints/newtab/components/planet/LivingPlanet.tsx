import '../../styles/planet.css';

interface LivingPlanetProps {
  /** 구의 지름(px). 원본(400px)의 비율 그대로 줄인다. 바깥 틀은 지름의 1.25배다. */
  size: number;
}

/**
 * 홈·아틀라스의 행성 — 레퍼런스(Aura · Daily Sync)의 구를 그대로 옮겼다.
 * 색·그림자·흐림·숨쉬기·윤곽 출렁임·실선 두 줄의 값은 원본과 같고, 크기만 size 로 줄인다.
 */
export function LivingPlanet({ size }: LivingPlanetProps) {
  return (
    <span
      className="planet-orb"
      style={{ '--s': size / 400 } as React.CSSProperties}
      aria-hidden
    >
      <span className="planet-orb__glow" />
      <span className="planet-orb__base" />
      <span className="planet-orb__vein" />
      <span className="planet-orb__vein planet-orb__vein--inner" />
    </span>
  );
}
