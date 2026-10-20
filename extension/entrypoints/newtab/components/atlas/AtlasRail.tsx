import { useRef } from 'react';
import type { OrbitPoint } from './data';

const cx = (...classes: (string | false | undefined | null)[]) => classes.filter(Boolean).join(' ');

interface AtlasRailProps {
  title: string;
  hue: string;
  points: OrbitPoint[];
  selectedPointId: string | null;
  onSelectPoint: (pointId: string) => void;
  /** 네비게이터 세로 순서에서 바로 위·아래 줄(세션 또는 폴더) 이름. 끝이면 null. */
  prevLabel: string | null;
  nextLabel: string | null;
  onStepVertical: (direction: 1 | -1) => void;
}

/**
 * 갤러리 위의 일자 막대 — 예전 궤도를 곧게 편 것이다(대표 2026-10-20).
 *
 * 점 하나가 페이지 하나이고 방문 순서대로 놓인다. 점을 누르거나 막대 위를 끌면 그 페이지로
 * 가고, 갤러리가 따라온다. 위·아래 줄은 네비게이터의 이전·다음 세션(또는 폴더)이라 누르면
 * ↑↓ 와 같이 옮겨 간다.
 */
export function AtlasRail({
  title,
  hue,
  points,
  selectedPointId,
  onSelectPoint,
  prevLabel,
  nextLabel,
  onStepVertical,
}: AtlasRailProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const total = points.length;
  // 아직 아무것도 고르지 않았으면 갤러리 가운데의 첫 페이지가 지금 자리다.
  const selectedIndex = Math.max(0, points.findIndex((point) => point.id === selectedPointId));
  const position = (index: number) => `${((index + 0.5) / total) * 100}%`;

  /** 막대 위 x 좌표에서 가장 가까운 점을 고른다(누르기·끌기 공통). */
  const scrubTo = (clientX: number) => {
    const track = trackRef.current;
    if (!track || total === 0) return;
    const rect = track.getBoundingClientRect();
    const index = Math.min(total - 1, Math.max(0, Math.floor(((clientX - rect.left) / rect.width) * total)));
    if (points[index].id !== selectedPointId) onSelectPoint(points[index].id);
  };

  return (
    <div className="atlas-rail" style={{ '--rail-hue': hue } as React.CSSProperties}>
      <button
        type="button"
        className="atlas-rail__neighbor"
        onClick={() => onStepVertical(-1)}
        disabled={!prevLabel}
        aria-label={prevLabel ? `위로: ${prevLabel}` : undefined}
      >
        <i className="ph ph-caret-up" />
        <span>{prevLabel ?? ''}</span>
      </button>

      <div className="atlas-rail__row">
        <span className="atlas-rail__title" title={title}>{title}</span>
        <div
          ref={trackRef}
          className="atlas-rail__track"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            scrubTo(event.clientX);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) scrubTo(event.clientX);
          }}
        >
          <span className="atlas-rail__line" />
          {points.map((point, index) => (
            <span
              key={point.id}
              className={cx('atlas-rail__dot', index === selectedIndex && 'atlas-rail__dot--active')}
              style={{ left: position(index) }}
              title={`${index + 1}. ${point.title}`}
            />
          ))}
        </div>
        <span className="atlas-rail__count">
          {selectedIndex + 1} / {total}
        </span>
      </div>

      <button
        type="button"
        className="atlas-rail__neighbor"
        onClick={() => onStepVertical(1)}
        disabled={!nextLabel}
        aria-label={nextLabel ? `아래로: ${nextLabel}` : undefined}
      >
        <i className="ph ph-caret-down" />
        <span>{nextLabel ?? ''}</span>
      </button>
    </div>
  );
}
