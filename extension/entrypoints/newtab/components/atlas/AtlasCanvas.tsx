import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { OrbitScene, OrbitTrack } from './data';
import {
  formatMinutes,
  isVisibleSlot,
  normalizeRotation,
  orbitSlot,
  ORBIT_VISIBLE_SLOTS,
  visibleIndices,
} from './data';

const cx = (...classes: (string | false | undefined | null)[]) => classes.filter(Boolean).join(' ');

const HINT_STORAGE_KEY = 'orbit.atlas.hint-dismissed';
/** 궤도 타원의 세로/가로 비 — 위에서 비스듬히 내려다본 느낌 */
const RATIO = 0.8;
const PLANET_Y_MIN = 118;
const PLANET_R = 19;
/** 레이블 칩이 차지하는 세로 여백 */
const LABEL_GUTTER = 34;
const CHIP_H = 30;
const CHIP_W = 232;
const INSET_MAX = 250;
const R_ABS_MAX = 360;

/**
 * 한 번에 온전히 그리는 궤도 수. 이보다 많으면 창을 밀어 이동한다.
 *
 * 궤도는 바깥으로 갈수록 화면 폭까지 잡아먹어, 전부 그리면 좌우가 잘려
 * 점도 칩도 누를 수 없게 된다. 창 밖 첫 궤도는 아래에 걸친 채 흐리게 남겨
 * "더 있다"가 보이도록 한다.
 */
const MAX_RENDERED_ORBITS = 4;

/** 점을 놓기 시작하는 각도 — 아크 끝에 딱 붙지 않게 띄운다. */
const SLOT_ANGLE_LO = 18;

const readHintDismissed = () => {
  try {
    return localStorage.getItem(HINT_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

const pointOnArc = (rx: number, ry: number, angleDeg: number) => {
  const radians = (angleDeg * Math.PI) / 180;
  return { x: -rx * Math.cos(radians), y: ry * Math.sin(radians) };
};

/**
 * 궤도선 기본 농도 — 안쪽(최근)이 진하고 바깥으로 갈수록 옅어진다.
 * 메인 페이지 시그니처 그래픽의 링 농도 그라데이션과 같은 어법.
 */
const arcOpacity = (index: number, total: number) =>
  total <= 1 ? 0.72 : 0.85 - (index / (total - 1)) * 0.35;

/**
 * 슬롯 번호를 실제 각도로 바꾼다.
 *
 * 칩이 없는 궤도는 앞면 반원에 균등히 놓는다. 칩이 있는 궤도는 최하단(90도)이
 * 칩 자리라, 칩 폭만큼의 각도 구간을 비우고 좌우로 갈라 놓는다.
 */
function slotAngle(slot: number, rx: number, hasChip: boolean): number {
  const span = 180 - SLOT_ANGLE_LO * 2;
  if (!hasChip) return SLOT_ANGLE_LO + ((slot + 0.5) / ORBIT_VISIBLE_SLOTS) * span;

  const cut = Math.min(
    76,
    Math.max(38, (Math.acos(Math.min(0.94, (CHIP_W / 2 + 16) / rx)) * 180) / Math.PI),
  );
  const leftSlots = Math.ceil(ORBIT_VISIBLE_SLOTS / 2);
  const rightSlots = ORBIT_VISIBLE_SLOTS - leftSlots;

  if (slot < leftSlots) {
    return SLOT_ANGLE_LO + ((slot + 0.5) / leftSlots) * (cut - SLOT_ANGLE_LO);
  }
  const k = slot - leftSlots;
  return 180 - cut + ((k + 0.5) / rightSlots) * (cut - SLOT_ANGLE_LO);
}

/** 선택된 점이 앞면 가운데쯤 오도록 하는 회전량. */
const rotationToReveal = (index: number) => index - Math.floor(ORBIT_VISIBLE_SLOTS / 2);

interface AtlasCanvasProps {
  scene: OrbitScene | null;
  /** 폴더 씬에서 지금 펼쳐 놓은 세션. 이 궤도의 페이지만 위성으로 그린다. */
  activeTrackId: string | null;
  selectedPointId: string | null;
  onSelectPoint: (pointId: string, sessionId: string | null) => void;
  /** 폴더 씬에서 궤도(=세션)를 펼칠 때. 세션 씬에서는 호출되지 않는다. */
  onSelectTrack: (sessionId: string) => void;
  onClearSelection: () => void;
  bottomInset: number;
  emptyMessage?: string;
}

export function AtlasCanvas({
  scene,
  activeTrackId,
  selectedPointId,
  onSelectPoint,
  onSelectTrack,
  onClearSelection,
  bottomInset,
  emptyMessage,
}: AtlasCanvasProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 860, h: 620 });
  const [hintClosed, setHintClosed] = useState(false);
  const [hintMuted, setHintMuted] = useState(readHintDismissed);
  const [hoveredTrackId, setHoveredTrackId] = useState<string | null>(null);

  /** 궤도별 회전량. 씬이 바뀌면 비운다. */
  const [rotations, setRotations] = useState<Record<string, number>>({});
  /** 궤도 축에서 지금 보고 있는 창의 시작 인덱스. */
  const [axisIndex, setAxisIndex] = useState(0);

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

  const sceneId = scene?.id ?? null;
  useEffect(() => {
    setRotations({});
    setAxisIndex(0);
  }, [sceneId]);

  const tracks = scene?.tracks ?? [];
  const isFolder = scene?.kind === 'folder';
  const maxAxisIndex = Math.max(0, tracks.length - MAX_RENDERED_ORBITS);
  const safeAxisIndex = Math.min(axisIndex, maxAxisIndex);

  // 창 밖 첫 궤도까지 하나 더 그린다 — 아래에 걸쳐 흐리게 남아 "더 있다"를 보여준다.
  const windowTracks = tracks.slice(safeAxisIndex, safeAxisIndex + MAX_RENDERED_ORBITS + 1);
  const hiddenInside = safeAxisIndex;
  const hiddenOutside = Math.max(0, tracks.length - (safeAxisIndex + MAX_RENDERED_ORBITS));

  const rotationOf = (track: OrbitTrack) =>
    normalizeRotation(rotations[track.id] ?? 0, track.points.length);

  const rotateTrack = (track: OrbitTrack, direction: 1 | -1) => {
    if (track.points.length <= ORBIT_VISIBLE_SLOTS) return;
    setRotations((prev) => ({
      ...prev,
      [track.id]: normalizeRotation((prev[track.id] ?? 0) + direction, track.points.length),
    }));
  };

  /**
   * 폴더 씬에서 점을 그리는 궤도는 펼쳐 놓은 세션 하나뿐이다.
   * 궤도마다 점을 다 뿌리면 세션 5개 x 페이지 30개에서 150개가 겹쳐 누를 수 없다.
   */
  const isOpenTrack = (track: OrbitTrack) => !isFolder || track.id === activeTrackId;

  /** 선택된 점이 뒤편이나 창 밖에 있으면 보이는 자리로 데려온다. */
  useEffect(() => {
    if (!selectedPointId || tracks.length === 0) return;

    const trackIndex = tracks.findIndex((track) =>
      track.points.some((point) => point.id === selectedPointId),
    );
    if (trackIndex < 0) return;

    const track = tracks[trackIndex];
    const pointIndex = track.points.findIndex((point) => point.id === selectedPointId);

    setAxisIndex((prev) => {
      const clamped = Math.min(prev, maxAxisIndex);
      if (trackIndex < clamped) return trackIndex;
      if (trackIndex >= clamped + MAX_RENDERED_ORBITS) {
        return Math.min(maxAxisIndex, trackIndex - MAX_RENDERED_ORBITS + 1);
      }
      return clamped;
    });

    setRotations((prev) => {
      const total = track.points.length;
      const current = normalizeRotation(prev[track.id] ?? 0, total);
      if (isVisibleSlot(orbitSlot(pointIndex, current, total))) return prev;
      return { ...prev, [track.id]: normalizeRotation(rotationToReveal(pointIndex), total) };
    });
  }, [selectedPointId, tracks, maxAxisIndex]);

  /**
   * ←→ 는 펼친 궤도를 돌리고, ↑↓ 는 궤도 축을 옮긴다.
   *
   * 의존성을 비워 두면 닫힌 회전량·창 인덱스를 붙잡는다. 리스너 하나라 매 렌더
   * 재등록이 더 안전하고 싸다.
   */
  useEffect(() => {
    if (!scene) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const track = windowTracks.find(isOpenTrack);
        if (!track) return;
        event.preventDefault();
        rotateTrack(track, event.key === 'ArrowRight' ? 1 : -1);
        return;
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (maxAxisIndex === 0) return;
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        setAxisIndex((current) =>
          Math.max(0, Math.min(maxAxisIndex, Math.min(current, maxAxisIndex) + direction)),
        );
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  /**
   * 캔버스 위 휠은 궤도 축 이동.
   *
   * React 의 onWheel 은 passive 로 등록돼 preventDefault 가 먹지 않는다 —
   * 페이지가 같이 스크롤되지 않도록 여기서 직접 non-passive 로 건다.
   */
  useEffect(() => {
    const element = stageRef.current;
    if (!element || maxAxisIndex === 0) return;

    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) < 4) return;
      event.preventDefault();
      setAxisIndex((prev) =>
        Math.max(0, Math.min(maxAxisIndex, Math.min(prev, maxAxisIndex) + (event.deltaY > 0 ? 1 : -1))),
      );
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [maxAxisIndex]);

  const orbitCount = Math.max(1, Math.min(windowTracks.length, MAX_RENDERED_ORBITS));

  // 반경은 트레이가 열린 최악의 높이 기준으로 잡아 어떤 상태에서도 넘치지 않게 한다.
  const rxCap = Math.max(150, size.w / 2 - 28);
  const availableHeight = Math.max(240, size.h - INSET_MAX);
  const ryCap = Math.max(96, availableHeight - PLANET_Y_MIN - LABEL_GUTTER - 32);
  const rMax = Math.min(rxCap, ryCap / RATIO, R_ABS_MAX);
  const r0 = Math.min(PLANET_R + 160, rMax);
  const step = orbitCount > 1 ? (rMax - r0) / (orbitCount - 1) : 0;

  const orbitLayouts = windowTracks.map((track, index) => {
    const rx = orbitCount === 1 ? (r0 + rMax) / 2 : r0 + index * step;
    return {
      track,
      rx,
      ry: rx * RATIO,
      index,
      // 창 밖 첫 궤도는 실제로 화면 아래로 넘어간다 — 흐리게 두고 조작은 막는다.
      beyondWindow: index >= MAX_RENDERED_ORBITS,
    };
  });

  const systemHeight = rMax * RATIO + LABEL_GUTTER;
  const planetY = Math.max(
    PLANET_Y_MIN,
    (Math.max(240, size.h - bottomInset) - systemHeight) / 2,
  );
  const centerX = size.w / 2;
  const hue = scene?.hue ?? '#ef6f47';
  const chipGap = step * RATIO;

  const selectedLocation = orbitLayouts
    .map((layout) => ({
      layout,
      pointIndex: layout.track.points.findIndex((point) => point.id === selectedPointId),
    }))
    .find(({ pointIndex }) => pointIndex >= 0);

  const totalPoints = tracks.reduce((sum, track) => sum + track.points.length, 0);

  return (
    <div className="atlas-stage" ref={stageRef}>
      {scene && (
        <div className="atlas-stage__scaler">
          <svg className="atlas-stage__svg" width={size.w} height={size.h} aria-hidden>
            <g
              transform={`translate(${centerX}, ${planetY})`}
              style={{ '--arc-hue': hue } as React.CSSProperties}
            >
              <defs>
                {/* 궤도선이 노드 높이(y=0)에서 서서히 나타나도록 위쪽을 페이드아웃 */}
                <linearGradient id="atlas-arc-fade" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="104">
                  <stop offset="0" stopColor="#fff" stopOpacity="0.12" />
                  <stop offset="0.5" stopColor="#fff" stopOpacity="0.72" />
                  <stop offset="1" stopColor="#fff" stopOpacity="1" />
                </linearGradient>
                <mask
                  id="atlas-arc-mask"
                  maskUnits="userSpaceOnUse"
                  x={-centerX}
                  y={-40}
                  width={centerX * 2}
                  height={size.h}
                >
                  <rect x={-centerX} y={-40} width={centerX * 2} height={size.h} fill="url(#atlas-arc-fade)" />
                </mask>
                <radialGradient id="atlas-node-glow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor={hue} stopOpacity="0.14" />
                  <stop offset="100%" stopColor={hue} stopOpacity="0" />
                </radialGradient>
              </defs>

              {/* 클릭 히트 영역 (마스크 밖에 둬서 페이드와 무관하게 잡히도록) */}
              {isFolder &&
                orbitLayouts.map(({ track, rx, ry, beyondWindow }) =>
                  beyondWindow || !track.sessionId ? null : (
                    <path
                      key={`hit-${track.id}`}
                      d={`M ${-rx} 0 A ${rx} ${ry} 0 0 0 ${rx} 0`}
                      className="atlas-arc__hit"
                      onClick={() => onSelectTrack(track.sessionId as string)}
                      onMouseEnter={() => setHoveredTrackId(track.id)}
                      onMouseLeave={() => setHoveredTrackId(null)}
                    />
                  ),
                )}

              <g mask="url(#atlas-arc-mask)">
                {orbitLayouts.map(({ track, rx, ry, index, beyondWindow }) => {
                  const isOpen = isFolder && track.id === activeTrackId;
                  const isHovered = hoveredTrackId === track.id;
                  const isDimmed = isFolder && activeTrackId !== null && !isOpen;
                  const base = arcOpacity(index, orbitCount);
                  return (
                    <path
                      key={track.id}
                      d={`M ${-rx} 0 A ${rx} ${ry} 0 0 0 ${rx} 0`}
                      vectorEffect="non-scaling-stroke"
                      className={cx(
                        'atlas-arc',
                        isOpen && 'atlas-arc--active',
                        isHovered && !isOpen && 'atlas-arc--hover',
                        beyondWindow && 'atlas-arc--beyond',
                      )}
                      style={{
                        opacity: beyondWindow
                          ? 0.2
                          : isOpen
                            ? 1
                            : isHovered
                              ? 0.95
                              : isDimmed
                                ? base * 0.45
                                : base,
                        stroke: isFolder ? track.hue : undefined,
                      }}
                    />
                  );
                })}
              </g>

              {/* 선택된 페이지로 향하는 연결선 */}
              {selectedLocation && !selectedLocation.layout.beyondWindow && (() => {
                const { layout, pointIndex } = selectedLocation;
                if (!isOpenTrack(layout.track)) return null;
                const total = layout.track.points.length;
                const slot = orbitSlot(pointIndex, rotationOf(layout.track), total);
                if (!isVisibleSlot(slot)) return null;
                const point = pointOnArc(
                  layout.rx,
                  layout.ry,
                  slotAngle(slot, layout.rx, layout.track.chip !== null),
                );
                return <line className="atlas-arc__link" x1={0} y1={0} x2={point.x} y2={point.y} />;
              })()}

              <g className="atlas-node" onClick={onClearSelection}>
                <title>{scene.title} — 전체 보기</title>
                <circle r={PLANET_R * 3.6} fill="url(#atlas-node-glow)" pointerEvents="none" />
                <circle className="atlas-node__halo" r={PLANET_R * 1.85} />
                <circle className="atlas-node__core" r={PLANET_R} />
                <circle className="atlas-node__rim" r={PLANET_R} vectorEffect="non-scaling-stroke" />
              </g>
            </g>
          </svg>

          <div className="atlas-planet-label" style={{ left: centerX, top: planetY + PLANET_R + 20 }}>
            <div className="atlas-planet-label__title">{scene.title}</div>
            <div className="atlas-planet-label__meta">{scene.meta}</div>
          </div>

          {/* 세션 레이블 칩 — 각 호의 최하단 바로 아래 */}
          {orbitLayouts.map(({ track, ry, index, beyondWindow }) => {
            if (!track.chip || beyondWindow) return null;
            const isOpen = track.id === activeTrackId;
            const isHovered = hoveredTrackId === track.id;
            // 호 간격이 좁아 칩이 겹칠 수 있으면 좌우로 번갈아 밀어낸다.
            const dx =
              orbitCount < 2 || chipGap >= CHIP_H + 6
                ? 0
                : (index % 2 === 0 ? -1 : 1) * (CHIP_W / 2 + 10);
            return (
              <button
                key={`chip-${track.id}`}
                type="button"
                className={cx(
                  'atlas-chip',
                  isOpen && 'atlas-chip--active',
                  isHovered && 'atlas-chip--hover',
                )}
                style={{
                  left: centerX,
                  top: planetY + ry + 11,
                  '--chip-dx': `${dx}px`,
                  '--chip-hue': track.hue,
                } as React.CSSProperties}
                onClick={() => onSelectTrack(track.sessionId as string)}
                onMouseEnter={() => setHoveredTrackId(track.id)}
                onMouseLeave={() => setHoveredTrackId(null)}
                title={`${track.label} — ${track.chip.date}`}
              >
                {track.chip.status === 'live' && <span className="atlas-chip__live" />}
                <span className="atlas-chip__title">{track.label}</span>
                <span className="atlas-chip__meta">
                  {track.points.length}p · {formatMinutes(track.chip.minutes)}
                </span>
                <span className="atlas-chip__date">{track.chip.date}</span>
              </button>
            );
          })}

          {/* 페이지 위성 — 폴더 씬에서는 펼친 세션 하나만 */}
          {orbitLayouts.flatMap((layout) => {
            if (layout.beyondWindow || !isOpenTrack(layout.track)) return [];
            const total = layout.track.points.length;
            const rotation = rotationOf(layout.track);
            const hasChip = layout.track.chip !== null;

            return layout.track.points.map((point, index) => {
              const slot = orbitSlot(index, rotation, total);
              if (!isVisibleSlot(slot)) return null;
              const at = pointOnArc(layout.rx, layout.ry, slotAngle(slot, layout.rx, hasChip));
              const isActive = selectedPointId === point.id;
              return (
                <button
                  key={`${layout.track.id}-${point.id}`}
                  type="button"
                  className={cx('atlas-sat', isActive && 'atlas-sat--active')}
                  style={{
                    left: centerX + at.x,
                    top: planetY + at.y,
                    background: layout.track.hue,
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectPoint(point.id, layout.track.sessionId);
                  }}
                  aria-label={`${index + 1}. ${point.title}`}
                >
                  <span className="atlas-sat__hit" />
                  <span
                    className={cx(
                      'atlas-sat__tip',
                      at.x > 0 ? 'atlas-sat__tip--left' : 'atlas-sat__tip--right',
                    )}
                  >
                    <span className="atlas-sat__tip-title">{index + 1}. {point.title}</span>
                    <span className="atlas-sat__tip-meta">
                      <span className="atlas-sat__tip-domain">{point.domain}</span>
                      {point.minutes > 0 && <span>· {point.minutes}분</span>}
                      {point.visits > 1 && <span>· 총 {point.visits}회 방문</span>}
                    </span>
                  </span>
                </button>
              );
            });
          })}

          {/* 펼친 궤도의 회전 컨트롤 — 뒤편에 남은 개수를 알린다 */}
          {orbitLayouts.map((layout) => {
            const { track } = layout;
            if (layout.beyondWindow || !isOpenTrack(track)) return null;
            if (track.points.length <= ORBIT_VISIBLE_SLOTS) return null;

            const shown = visibleIndices(track.points.length, rotationOf(track));
            const first = shown.length ? shown[0] + 1 : 0;
            const last = shown.length ? shown[shown.length - 1] + 1 : 0;

            return (
              <div
                key={`rotate-${track.id}`}
                className="atlas-rotate"
                style={{ left: centerX, top: planetY + layout.ry + (track.chip ? 48 : 16) }}
              >
                <button
                  type="button"
                  aria-label="궤도 뒤로 돌리기"
                  onClick={() => rotateTrack(track, -1)}
                >
                  <i className="ph ph-caret-left" />
                </button>
                {/* 뒤편에 몇 개가 남았는지 알려주지 않으면 끝까지 돌려봐야만 알 수 있다. */}
                <span className="atlas-rotate__count">
                  {first}–{last} / {track.points.length}
                </span>
                <button
                  type="button"
                  aria-label="궤도 앞으로 돌리기"
                  onClick={() => rotateTrack(track, 1)}
                >
                  <i className="ph ph-caret-right" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* 창 밖 궤도 — 아래쪽을 흐리게 덮고 남은 개수를 알린다. */}
      {scene && hiddenOutside > 0 && (
        <div
          className="atlas-stage__axis atlas-stage__axis--out"
          style={{ bottom: bottomInset }}
        >
          <button
            type="button"
            onClick={() => setAxisIndex((prev) => Math.min(maxAxisIndex, prev + 1))}
          >
            <i className="ph ph-caret-down" />
            <span>바깥 궤도 {hiddenOutside}개 더</span>
          </button>
        </div>
      )}

      {scene && hiddenInside > 0 && (
        <div className="atlas-stage__axis atlas-stage__axis--in">
          <button type="button" onClick={() => setAxisIndex((prev) => Math.max(0, prev - 1))}>
            <i className="ph ph-caret-up" />
            <span>안쪽 궤도 {hiddenInside}개</span>
          </button>
        </div>
      )}

      {!scene && (
        <div className="atlas-stage__empty">
          <i className="ph ph-planet" />
          <p>{emptyMessage ?? '왼쪽 네비게이터에서 세션을 선택하세요'}</p>
        </div>
      )}

      {scene && tracks.length === 0 && (
        <div className="atlas-stage__empty">
          <i className="ph ph-file-dashed" />
          <p>
            {isFolder
              ? '이 폴더에는 아직 세션이 없습니다'
              : '이 세션에는 표시할 페이지 기록이 없습니다'}
          </p>
        </div>
      )}

      {scene && totalPoints > 0 && !selectedPointId && !hintClosed && !hintMuted && (
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
          <span>
            {isFolder
              ? '궤도나 레이블을 클릭하면 해당 세션의 페이지가 펼쳐집니다'
              : '페이지는 방문 순서대로 안쪽 궤도부터 배치됩니다 · ←→ 로 돌려 나머지를 봅니다'}
          </span>
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
