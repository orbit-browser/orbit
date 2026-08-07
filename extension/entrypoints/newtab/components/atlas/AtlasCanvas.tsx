import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

  /*
   * 안내 알약은 평소 가운데 정렬(translateX(-50%))이라 폭이 늘면 X 가 옆으로 밀린다.
   * X 를 겨눈 커서 아래로 "다시 보지 않기" 가 들어와 클릭이 그쪽으로 먹는다.
   * 그래서 커서를 올린 **그 순간의 실제 위치를 재서 고정**하고, 문구는 오른쪽으로만 펼친다.
   * CSS 만으로 폭을 보정하려면 문구 길이를 상수로 박아야 해서 글자가 바뀌면 어긋난다.
   */
  const hintRef = useRef<HTMLDivElement>(null);
  const [hintFrozenLeft, setHintFrozenLeft] = useState<number | null>(null);
  /** 등장 애니메이션은 처음 한 번만 — 이후 클래스가 바뀌어도 다시 올라오지 않는다. */
  const [hintEntered, setHintEntered] = useState(false);

  const unfreezeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const freezeHint = () => {
    if (unfreezeTimer.current) {
      clearTimeout(unfreezeTimer.current);
      unfreezeTimer.current = null;
    }
    const stage = stageRef.current;
    const hint = hintRef.current;
    if (!stage || !hint || hintFrozenLeft !== null) return;
    // 스테이지 기준 좌표로 바꿔 둬야 창 크기가 바뀌어도 어긋나지 않는다.
    setHintFrozenLeft(hint.getBoundingClientRect().left - stage.getBoundingClientRect().left);
  };

  /**
   * 문구가 다 접힌 뒤에 고정을 푼다.
   * 즉시 풀면 알약이 먼저 가운데로 돌아간 뒤 폭이 줄어들어, 왼쪽에서 미끄러져 오는 것처럼 보인다.
   */
  const releaseHint = () => {
    if (unfreezeTimer.current) clearTimeout(unfreezeTimer.current);
    unfreezeTimer.current = setTimeout(() => {
      setHintFrozenLeft(null);
      unfreezeTimer.current = null;
    }, 300); // 문구 접힘 전환(0.26s)보다 살짝 길게
  };

  useEffect(() => () => {
    if (unfreezeTimer.current) clearTimeout(unfreezeTimer.current);
  }, []);


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
        <div
          ref={hintRef}
          className={`atlas-stage__hint${hintEntered ? '' : ' atlas-stage__hint--enter'}`}
          onAnimationEnd={() => setHintEntered(true)}
          style={
            hintFrozenLeft !== null
              ? { left: `${hintFrozenLeft}px`, transform: 'none' }
              : undefined
          }
        >
          <span>페이지는 방문 순서대로 안쪽 궤도부터 배치됩니다</span>
          <span
            className="atlas-stage__hint-actions"
            onMouseEnter={freezeHint}
            onMouseLeave={releaseHint}
          >
            <button
              type="button"
              className="atlas-stage__hint-close"
              onClick={() => setHintClosed(true)}
              aria-label="안내 닫기"
            >
              <i className="ph ph-x" />
            </button>
            {/* X 뒤에 둬서 오른쪽으로 펼쳐진다. 위치가 고정돼 있어 X 는 움직이지 않는다. */}
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
