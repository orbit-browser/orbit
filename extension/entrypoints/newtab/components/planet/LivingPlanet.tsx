import '../../styles/planet.css';

interface LivingPlanetProps {
  /** 지름(px). 숨 쉬는 애니메이션은 이 크기를 기준으로 조금 부푼다. */
  size: number;
  /** 행성 색. 없으면 강조색 — 아틀라스는 세션 색을 넘긴다. */
  hue?: string;
  className?: string;
}

/**
 * 홈과 아틀라스의 중심 행성.
 *
 * 단색 원 대신 윤곽이 천천히 바뀌는 말랑한 구로 그린다. 빛을 받는 쪽은 거의 흰색,
 * 반대쪽은 행성 색으로 짙어지고, 안쪽의 실선 두 줄이 조금씩 어긋나 돈다.
 * 그림은 전부 CSS(planet.css)라 SVG 안팎 어디에나 얹을 수 있다.
 */
export function LivingPlanet({ size, hue, className }: LivingPlanetProps) {
  return (
    <span
      className={`living-planet${className ? ` ${className}` : ''}`}
      style={{ '--lp-size': `${size}px`, ...(hue ? { '--lp-hue': hue } : null) } as React.CSSProperties}
      aria-hidden
    >
      <span className="living-planet__glow" />
      <span className="living-planet__body" />
      <span className="living-planet__sheen" />
      <span className="living-planet__vein" />
      <span className="living-planet__vein living-planet__vein--light" />
    </span>
  );
}
