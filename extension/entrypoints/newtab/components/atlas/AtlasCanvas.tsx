import { useLayoutEffect, useRef, useState } from 'react';
import type { OrbitNode, SessionNode } from './data';
import { formatMinutes, orbitPageCount, orbitMinutes } from './data';

const cx = (...classes: (string | false | undefined | null)[]) => classes.filter(Boolean).join(' ');

const HINT_STORAGE_KEY = 'orbit.atlas.hint-dismissed';

const readHintDismissed = () => {
  try {
    return localStorage.getItem(HINT_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

/** 궤도 타원의 세로/가로 비 — 위에서 비스듬히 내려다본 느낌 */
const RATIO = 0.8;
/** 중심 노드의 최소 상단 여백 */
const PLANET_Y_MIN = 118;
/** 중심 노드 반지름 — 메인 페이지 시그니처 그래픽과 같은 평면 점 */
const PLANET_R = 19;
/** 레이블 칩이 차지하는 세로 여백 */
const LABEL_GUTTER = 34;
const CHIP_H = 30;
const CHIP_W = 232;
/** 부모가 넘기는 bottomInset 의 두 값 (트레이 닫힘 / 열림) */
const INSET_MIN = 40;
const INSET_MAX = 250;
/**
 * 궤도 최대 반경 상한.
 * 네비게이터를 여닫으면 캔버스 폭이 288px 바뀌는데, 반경을 폭에 맡기면
 * 그때마다 행성·위성 크기가 튄다. 좁은 쪽(네비 열림)에서도 들어가는 값으로
 * 고정해 두면 폭이 변해도 크기는 그대로고 가로 위치만 미끄러진다.
 */
const R_ABS_MAX = 360;

/**
 * 페이지 위성 각도. 호의 최하단(90°)에는 세션 레이블 칩이 놓이므로
 * 칩 폭만큼의 각도 구간을 비우고 좌/우로 갈라 배치한다.
 */
const satelliteAngle = (index: number, total: number, rx: number) => {
  // 칩 절반 폭보다 바깥쪽에 있는 각도까지만 사용한다.
  const cut = Math.min(76, Math.max(38, (Math.acos(Math.min(0.94, (CHIP_W / 2 + 16) / rx)) * 180) / Math.PI));
  const lo = 18;
  const hi = 180 - lo;
  if (total === 1) return (lo + cut) / 2;
  const t = index / (total - 1);
  return t < 0.5 ? lo + t * 2 * (cut - lo) : 180 - cut + (t - 0.5) * 2 * (hi - (180 - cut));
};

const pointOnArc = (rx: number, ry: number, angleDeg: number) => {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: -rx * Math.cos(rad), y: ry * Math.sin(rad) };
};

/**
 * 궤도선 기본 농도 — 안쪽(최근 세션)이 진하고 바깥(오래된 세션)으로 갈수록 옅어진다.
 * 메인 페이지 시그니처 그래픽의 링 농도 그라데이션과 같은 어법.
 */
const arcOpacity = (index: number, total: number) =>
  total <= 1 ? 0.72 : 0.85 - (index / (total - 1)) * 0.35;

interface AtlasCanvasProps {
  orbit: OrbitNode | null;
  selectedSessionId: string | null;
  selectedPageId: string | null;
  onSelectSession: (id: string) => void;
  onSelectPage: (id: string) => void;
  onClearSelection: () => void;
  /** 하단 트레이가 가리는 높이 */
  bottomInset: number;
}

export function AtlasCanvas({
  orbit,
  selectedSessionId,
  selectedPageId,
  onSelectSession,
  onSelectPage,
  onClearSelection,
  bottomInset,
}: AtlasCanvasProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 860, h: 620 });
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  // 닫기(×)는 이번만 감추고, "다시 보지 않기"는 localStorage 에 남긴다.
  const [hintClosed, setHintClosed] = useState(false);
  const [hintMuted, setHintMuted] = useState(readHintDismissed);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: Math.max(320, width), h: Math.max(320, height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sessions = orbit?.sessions ?? [];
  const n = sessions.length;

  // 반경은 트레이가 열린 최악의 높이 기준으로 잡아 어떤 상태에서도 넘치지 않게 한다.
  const rxCap = Math.max(150, size.w / 2 - 28);
  const availWorst = Math.max(240, size.h - INSET_MAX);
  const ryCap = Math.max(96, availWorst - PLANET_Y_MIN - LABEL_GUTTER - 32);
  const rMax = Math.min(rxCap, ryCap / RATIO, R_ABS_MAX);
  const r0 = Math.min(PLANET_R + 160, rMax);
  const step = n > 1 ? (rMax - r0) / (n - 1) : 0;

  const systemH = rMax * RATIO + LABEL_GUTTER;
  const centerFor = (inset: number) =>
    Math.max(PLANET_Y_MIN, (Math.max(240, size.h - inset) - systemH) / 2);

  // 좌표는 고정된 기준 위치로 계산하고, 트레이 개폐에 따른 차이는
  // transform 으로 옮겨 위치가 튀지 않고 부드럽게 이동하게 한다.
  const planetY = centerFor(INSET_MIN);
  const stageShift = centerFor(bottomInset) - planetY;

  const arcs = sessions.map((session, i) => {
    const rx = n === 1 ? (r0 + rMax) / 2 : r0 + i * step;
    return { session, rx, ry: rx * RATIO, index: i };
  });

  const chipGap = step * RATIO;
  const activeArc = arcs.find((a) => a.session.id === selectedSessionId) ?? null;
  const activePageIndex = activeArc
    ? activeArc.session.pages.findIndex((p) => p.id === selectedPageId)
    : -1;

  const cx0 = size.w / 2;
  const hue = orbit?.hue ?? '#ef6f47';

  const renderSatellites = (arc: { session: SessionNode; rx: number; ry: number }) => {
    const total = arc.session.pages.length;
    return arc.session.pages.map((page, i) => {
      const angle = satelliteAngle(i, total, arc.rx);
      const { x, y } = pointOnArc(arc.rx, arc.ry, angle);
      const isActive = selectedPageId === page.id;
      return (
        <button
          key={page.id}
          type="button"
          className={cx('atlas-sat', isActive && 'atlas-sat--active')}
          style={{ left: cx0 + x, top: planetY + y }}
          onClick={(e) => {
            e.stopPropagation();
            onSelectPage(page.id);
          }}
          aria-label={page.title}
        >
          <span className="atlas-sat__hit" />
          <span className={cx('atlas-sat__tip', x > 0 ? 'atlas-sat__tip--left' : 'atlas-sat__tip--right')}>
            <span className="atlas-sat__tip-title">{page.title}</span>
            <span className="atlas-sat__tip-meta">
              <span className="atlas-sat__tip-domain">{page.domain}</span>
              <span>· {page.minutes}분</span>
              {page.visits > 1 && <span>· {page.visits}회 방문</span>}
            </span>
          </span>
        </button>
      );
    });
  };

  return (
    <div className="atlas-stage" ref={stageRef}>
      <div className="atlas-stage__scaler" style={{ transform: `translateY(${stageShift}px)` }}>
        <svg className="atlas-stage__svg" width={size.w} height={size.h} aria-hidden>
          <g transform={`translate(${cx0}, ${planetY})`} style={{ '--arc-hue': hue } as React.CSSProperties}>
            <defs>
              {/* 궤도선이 노드 높이(y=0)에서 서서히 나타나도록 위쪽을 페이드아웃 */}
              <linearGradient id="atlas-arc-fade" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="104">
                <stop offset="0" stopColor="#fff" stopOpacity="0.12" />
                <stop offset="0.5" stopColor="#fff" stopOpacity="0.72" />
                <stop offset="1" stopColor="#fff" stopOpacity="1" />
              </linearGradient>
              <mask id="atlas-arc-mask" maskUnits="userSpaceOnUse" x={-cx0} y={-40} width={cx0 * 2} height={size.h}>
                <rect x={-cx0} y={-40} width={cx0 * 2} height={size.h} fill="url(#atlas-arc-fade)" />
              </mask>
              <radialGradient id="atlas-node-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={hue} stopOpacity="0.14" />
                <stop offset="100%" stopColor={hue} stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* 클릭 히트 영역 (마스크 밖에 둬서 페이드와 무관하게 잡히도록) */}
            {arcs.map(({ session, rx, ry }) => (
              <path
                key={`hit-${session.id}`}
                d={`M ${-rx} 0 A ${rx} ${ry} 0 0 0 ${rx} 0`}
                className="atlas-arc__hit"
                onClick={() => onSelectSession(session.id)}
                onMouseEnter={() => setHoveredSessionId(session.id)}
                onMouseLeave={() => setHoveredSessionId(null)}
              />
            ))}

            {/* 궤도선 */}
            <g mask="url(#atlas-arc-mask)">
              {arcs.map(({ session, rx, ry, index }) => {
                const isActive = session.id === selectedSessionId;
                const isHovered = hoveredSessionId === session.id;
                const isDimmed = selectedSessionId !== null && !isActive;
                const base = arcOpacity(index, n);
                return (
                  <path
                    key={session.id}
                    d={`M ${-rx} 0 A ${rx} ${ry} 0 0 0 ${rx} 0`}
                    vectorEffect="non-scaling-stroke"
                    className={cx(
                      'atlas-arc',
                      isActive && 'atlas-arc--active',
                      isHovered && !isActive && 'atlas-arc--hover'
                    )}
                    style={{ opacity: isActive ? 1 : isHovered ? 0.95 : isDimmed ? base * 0.45 : base }}
                  />
                );
              })}
            </g>

            {/* 선택된 페이지로 향하는 연결선 */}
            {activeArc && activePageIndex >= 0 && (() => {
              const { x, y } = pointOnArc(
                activeArc.rx,
                activeArc.ry,
                satelliteAngle(activePageIndex, activeArc.session.pages.length, activeArc.rx)
              );
              return <line className="atlas-arc__link" x1={0} y1={0} x2={x} y2={y} />;
            })()}

            {/* 중심 노드 — 메인 페이지 시그니처 그래픽과 같은 평면 점 + 헤일로 */}
            <g className="atlas-node" onClick={onClearSelection}>
              <title>{orbit ? `${orbit.title} — Orbit 전체 보기` : 'Orbit'}</title>
              <circle r={PLANET_R * 3.6} fill="url(#atlas-node-glow)" pointerEvents="none" />
              <circle className="atlas-node__halo" r={PLANET_R * 1.85} />
              <circle className="atlas-node__core" r={PLANET_R} />
              <circle className="atlas-node__rim" r={PLANET_R} vectorEffect="non-scaling-stroke" />
            </g>
          </g>
        </svg>

        {/* 중심 노드 라벨 */}
        {orbit && (
          <div className="atlas-planet-label" style={{ left: cx0, top: planetY + PLANET_R + 20 }}>
            <div className="atlas-planet-label__title">{orbit.title}</div>
            <div className="atlas-planet-label__meta">
              세션 {orbit.sessions.length} · 페이지 {orbitPageCount(orbit)} · {formatMinutes(orbitMinutes(orbit))}
            </div>
          </div>
        )}

        {/* 세션 레이블 칩 (각 호의 최하단 바로 아래) */}
        {arcs.map(({ session, ry, index }) => {
          const isActive = session.id === selectedSessionId;
          const isHovered = hoveredSessionId === session.id;
          // 호 간격이 좁아 칩이 겹칠 수 있으면 좌우로 번갈아 밀어낸다.
          const dx = n < 2 || chipGap >= CHIP_H + 6 ? 0 : (index % 2 === 0 ? -1 : 1) * (CHIP_W / 2 + 10);
          return (
            <button
              key={session.id}
              type="button"
              className={cx('atlas-chip', isActive && 'atlas-chip--active', isHovered && 'atlas-chip--hover')}
              style={{
                left: cx0,
                top: planetY + ry + 11,
                '--chip-dx': `${dx}px`,
                '--chip-hue': hue,
              } as React.CSSProperties}
              onClick={() => onSelectSession(session.id)}
              onMouseEnter={() => setHoveredSessionId(session.id)}
              onMouseLeave={() => setHoveredSessionId(null)}
              title={`${session.title} — ${session.date}`}
            >
              {session.status === 'live' && <span className="atlas-chip__live" />}
              <span className="atlas-chip__title">{session.title}</span>
              <span className="atlas-chip__meta">
                {session.pages.length}p · {formatMinutes(session.minutes)}
              </span>
              <span className="atlas-chip__date">{session.date}</span>
            </button>
          );
        })}

        {/* 선택된 세션의 페이지 위성 */}
        {activeArc && renderSatellites(activeArc)}
      </div>

      {!orbit && (
        <div className="atlas-stage__empty">
          <i className="ph ph-planet"></i>
          <p>왼쪽 네비게이터에서 Orbit을 선택하세요</p>
        </div>
      )}

      {orbit && !selectedSessionId && !hintClosed && !hintMuted && (
        <div className="atlas-stage__hint">
          <span>궤도나 레이블을 클릭하면 해당 세션의 페이지가 펼쳐집니다</span>
          <span className="atlas-stage__hint-actions">
            <button
              type="button"
              className="atlas-stage__hint-close"
              onClick={() => setHintClosed(true)}
              aria-label="안내 닫기"
            >
              <i className="ph ph-x"></i>
            </button>
            <button
              type="button"
              className="atlas-stage__hint-never"
              onClick={() => {
                try {
                  localStorage.setItem(HINT_STORAGE_KEY, '1');
                } catch {
                  /* 저장 불가 환경에서도 이번 세션은 감춘다 */
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
