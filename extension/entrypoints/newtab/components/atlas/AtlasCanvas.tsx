import { useLayoutEffect, useRef, useState } from 'react';
import type { SessionNode } from './data';
import { formatMinutes, PAGES_PER_ORBIT, splitPagesIntoOrbits } from './data';

const cx = (...classes: (string | false | undefined | null)[]) => classes.filter(Boolean).join(' ');

const HINT_STORAGE_KEY = 'orbit.atlas.hint-dismissed';
const PLANET_Y_MIN = 118;
const PLANET_R = 19;
const INSET_MAX = 250;
const RATIO = 0.68;
const R_ABS_MAX = 390;
const ORBIT_GAP = 58;

const readHintDismissed = () => {
  try {
    return localStorage.getItem(HINT_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

const pageAngle = (index: number, total: number) => {
  if (total <= 1) return 90;
  return 14 + (index / (total - 1)) * 152;
};

const pointOnArc = (rx: number, ry: number, angleDeg: number) => {
  const radians = (angleDeg * Math.PI) / 180;
  return { x: -rx * Math.cos(radians), y: ry * Math.sin(radians) };
};

interface AtlasCanvasProps {
  session: SessionNode | null;
  selectedPageId: string | null;
  onSelectPage: (id: string) => void;
  onClearSelection: () => void;
  bottomInset: number;
}

export function AtlasCanvas({
  session,
  selectedPageId,
  onSelectPage,
  onClearSelection,
  bottomInset,
}: AtlasCanvasProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 860, h: 620 });
  const [hintClosed, setHintClosed] = useState(false);
  const [hintMuted, setHintMuted] = useState(readHintDismissed);

  useLayoutEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: Math.max(320, width), h: Math.max(320, height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const pageGroups = splitPagesIntoOrbits(session?.pages ?? []);
  const orbitCount = Math.max(1, pageGroups.length);
  const outerRx = Math.min(Math.max(150, size.w / 2 - 72), R_ABS_MAX);
  const availableHeight = Math.max(250, size.h - INSET_MAX);
  const outerRy = Math.min(
    outerRx * RATIO,
    Math.max(110, availableHeight - PLANET_Y_MIN - 64),
  );
  const renderedRatio = outerRy / outerRx;
  const innerRx = Math.max(150, outerRx - ORBIT_GAP * (orbitCount - 1));
  const orbitStep = orbitCount > 1 ? (outerRx - innerRx) / (orbitCount - 1) : 0;
  const orbitLayouts = pageGroups.map((pages, orbitIndex) => {
    const rx = innerRx + orbitStep * orbitIndex;
    return {
      pages,
      rx,
      ry: rx * renderedRatio,
      startIndex: orbitIndex * PAGES_PER_ORBIT,
    };
  });
  const planetY = Math.max(
    PLANET_Y_MIN,
    (Math.max(260, size.h - bottomInset) - outerRy) / 2,
  );
  const centerX = size.w / 2;
  const hue = session?.hue ?? '#ef6f47';
  const selectedLocation = orbitLayouts
    .map((layout) => ({
      layout,
      pageIndex: layout.pages.findIndex((page) => page.id === selectedPageId),
    }))
    .find(({ pageIndex }) => pageIndex >= 0);

  return (
    <div className="atlas-stage" ref={stageRef}>
      {session && (
        <div className="atlas-stage__scaler">
          <svg className="atlas-stage__svg" width={size.w} height={size.h} aria-hidden>
            <g
              transform={`translate(${centerX}, ${planetY})`}
              style={{ '--arc-hue': hue } as React.CSSProperties}
            >
              <defs>
                <radialGradient id="atlas-node-glow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor={hue} stopOpacity="0.14" />
                  <stop offset="100%" stopColor={hue} stopOpacity="0" />
                </radialGradient>
              </defs>
              {orbitLayouts.map((layout, orbitIndex) => (
                <path
                  key={orbitIndex}
                  d={`M ${-layout.rx} 0 A ${layout.rx} ${layout.ry} 0 0 0 ${layout.rx} 0`}
                  vectorEffect="non-scaling-stroke"
                  className="atlas-arc atlas-arc--active"
                  style={{ opacity: 0.58 + (orbitIndex / orbitCount) * 0.32 }}
                />
              ))}
              {selectedLocation && (() => {
                const point = pointOnArc(
                  selectedLocation.layout.rx,
                  selectedLocation.layout.ry,
                  pageAngle(selectedLocation.pageIndex, selectedLocation.layout.pages.length),
                );
                return <line className="atlas-arc__link" x1={0} y1={0} x2={point.x} y2={point.y} />;
              })()}
              <g className="atlas-node" onClick={onClearSelection}>
                <title>{session.title} — 세션 전체 보기</title>
                <circle r={PLANET_R * 3.6} fill="url(#atlas-node-glow)" pointerEvents="none" />
                <circle className="atlas-node__halo" r={PLANET_R * 1.85} />
                <circle className="atlas-node__core" r={PLANET_R} />
                <circle className="atlas-node__rim" r={PLANET_R} vectorEffect="non-scaling-stroke" />
              </g>
            </g>
          </svg>

          <div className="atlas-planet-label" style={{ left: centerX, top: planetY + PLANET_R + 20 }}>
            <div className="atlas-planet-label__title">{session.title}</div>
            <div className="atlas-planet-label__meta">
              페이지 {session.pages.length} · {formatMinutes(session.minutes)} · {session.date}
            </div>
          </div>

          {orbitLayouts.flatMap((layout) =>
            layout.pages.map((page, pageIndex) => {
              const point = pointOnArc(
                layout.rx,
                layout.ry,
                pageAngle(pageIndex, layout.pages.length),
              );
              const globalIndex = layout.startIndex + pageIndex;
              const isActive = selectedPageId === page.id;
              return (
                <button
                  key={page.id}
                  type="button"
                  className={cx('atlas-sat', isActive && 'atlas-sat--active')}
                  style={{ left: centerX + point.x, top: planetY + point.y }}
                  onClick={() => onSelectPage(page.id)}
                  aria-label={`${globalIndex + 1}. ${page.title}`}
                >
                  <span className="atlas-sat__hit" />
                  <span className={cx('atlas-sat__tip', point.x > 0 ? 'atlas-sat__tip--left' : 'atlas-sat__tip--right')}>
                    <span className="atlas-sat__tip-title">{globalIndex + 1}. {page.title}</span>
                    <span className="atlas-sat__tip-meta">
                      <span className="atlas-sat__tip-domain">{page.domain}</span>
                      <span>· {page.minutes}분</span>
                      {page.visits > 1 && <span>· 총 {page.visits}회 방문</span>}
                    </span>
                  </span>
                </button>
              );
            }),
          )}
        </div>
      )}

      {!session && (
        <div className="atlas-stage__empty">
          <i className="ph ph-circles-three" />
          <p>왼쪽 네비게이터에서 세션을 선택하세요</p>
        </div>
      )}

      {session && session.pages.length === 0 && (
        <div className="atlas-stage__empty">
          <i className="ph ph-file-dashed" />
          <p>이 세션에는 표시할 페이지 기록이 없습니다</p>
        </div>
      )}

      {session && session.pages.length > 0 && !selectedPageId && !hintClosed && !hintMuted && (
        <div className="atlas-stage__hint">
          <span>페이지는 방문 순서대로 안쪽 궤도부터 배치됩니다</span>
          <span className="atlas-stage__hint-actions">
            <button
              type="button"
              className="atlas-stage__hint-close"
              onClick={() => setHintClosed(true)}
              aria-label="안내 닫기"
            >
              <i className="ph ph-x" />
            </button>
            <button
              type="button"
              className="atlas-stage__hint-never"
              onClick={() => {
                try {
                  localStorage.setItem(HINT_STORAGE_KEY, '1');
                } catch {
                  // 저장 불가 환경에서는 이번 탭에서만 감춘다.
                }
                setHintMuted(true);
              }}
            >
              다시 보지 않기
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
