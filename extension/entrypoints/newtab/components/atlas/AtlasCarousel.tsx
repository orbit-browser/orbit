import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { OrbitPoint } from './data';
import { alignOffset, formatMinutes, normalizeRotation } from './data';
import { LivingPlanet } from '../planet/LivingPlanet';
import { PageFavicon } from './PageFavicon';
import { PagePreview } from './PagePreview';
import '../../styles/carousel.css';

const cx = (...classes: (string | false | undefined | null)[]) => classes.filter(Boolean).join(' ');

/** 이웃 카드 사이 최소 각도. 페이지가 많으면 이 간격으로 앞쪽 몇 장만 고리에 오르고 나머지는 행성 뒤에서 기다린다. */
const MIN_GAP = (40 * Math.PI) / 180;
/** 맨 뒤 카드의 크기 비 — 원근이 여기서 나온다. */
const BACK_SCALE = 0.56;
/** 카드 가로세로 비. 브라우저 탭 화면에 가깝게. */
const CARD_RATIO = 1.6;
/** 고리의 세로/가로 비 — 위에서 비스듬히 내려다본 각도. */
const TILT = 0.34;
/** 회전 보간의 시간 상수(ms). AtlasCanvas 의 SPIN_TAU 보다 조금 길다 — 카드가 무게 있게 멈춘다. */
const SNAP_TAU = 150;
const EPSILON = 0.002;
/** 이만큼 움직여야 끌기로 본다. 그 전에는 누르기다. */
const DRAG_THRESHOLD = 5;
/** 놓을 때의 속도를 이 시간(ms)만큼 더 굴린다 — 휙 넘기면 몇 장이 더 지나간다. */
const FLING_MS = 220;
/** 관성으로 더 넘어가는 최대 장 수. 너무 세게 튕겨도 한 바퀴 돌아 제자리로 오지 않게. */
const FLING_MAX = 2;
/** 고리 위 입자의 출발 위치(한 바퀴 중 비율)와 한 바퀴 시간 */
const DUST = [0, 0.17, 0.36, 0.52, 0.69, 0.84];
const DUST_SECONDS = 48;
const LABEL_H = 52;
const CAPTION_H = 54;
const CONTROL_H = 40;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Drag {
  pointerId: number;
  startX: number;
  startValue: number;
  lastX: number;
  lastTime: number;
  /** 회전 속도(칸/ms). 최근 움직임에 무게를 둔 평균. */
  velocity: number;
  active: boolean;
}

interface AtlasCarouselProps {
  title: string;
  meta: string;
  hue: string;
  points: OrbitPoint[];
  selectedPointId: string | null;
  onSelectPoint: (pointId: string) => void;
  onClearSelection: () => void;
  width: number;
  /** 아래 트레이를 뺀, 그릴 수 있는 높이 */
  height: number;
}

/**
 * 세션 씬 — 페이지 카드가 행성 둘레의 고리를 따라 돈다.
 *
 * 정면(고리 맨 아래)에 온 카드가 고른 페이지다. 끌어서 돌리고, 휠·←→·카드 누르기로도
 * 옮긴다. 뒤쪽 카드는 작고 흐려지며 행성 뒤로 지나가고, 앞쪽 카드는 행성 앞을 지난다.
 * 좌표는 회전량 하나에서 매 프레임 계산한다(점을 직접 옮기면 현을 따라가 고리를 벗어난다).
 */
export function AtlasCarousel({
  title,
  meta,
  hue,
  points,
  selectedPointId,
  onSelectPoint,
  onClearSelection,
  width,
  height,
}: AtlasCarouselProps) {
  const total = points.length;
  const selectedIndex = points.findIndex((point) => point.id === selectedPointId);

  /** 회전량 = 정면에 놓인 카드의 연속 인덱스. 프레임마다 바뀌므로 상태가 아니라 ref 다. */
  const motionRef = useRef({ value: Math.max(0, selectedIndex), target: Math.max(0, selectedIndex) });
  const frameRef = useRef<number | null>(null);
  const [, drawFrame] = useReducer((tick: number) => tick + 1, 0);

  const run = useCallback(() => {
    if (frameRef.current !== null) return;
    const tau = prefersReducedMotion() ? 1 : SNAP_TAU;
    let previous = performance.now();
    const step = (now: number) => {
      // 탭이 잠들었다 깨면 dt 가 커진다 — 한 프레임에 건너뛰지 않도록 자른다.
      const dt = Math.min(64, Math.max(1, now - previous));
      previous = now;
      const motion = motionRef.current;
      const diff = motion.target - motion.value;
      motion.value = Math.abs(diff) < EPSILON ? motion.target : motion.value + diff * (1 - Math.exp(-dt / tau));
      drawFrame();
      frameRef.current = motion.value === motion.target ? null : requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);
  }, []);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const dragRef = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState(false);
  /** 끌고 난 직후의 click 은 누르기가 아니다. */
  const suppressClickRef = useRef(false);

  // 선택이 곧 회전이다 — 고른 카드가 가까운 쪽으로 돌아 정면에 온다.
  useEffect(() => {
    if (selectedIndex < 0 || dragRef.current?.active) return;
    const motion = motionRef.current;
    const target = alignOffset(motion.target, selectedIndex, total);
    if (target === motion.target) return;
    motion.target = target;
    run();
  }, [selectedIndex, total, run]);

  // 휠이 남긴 회전을 가장 가까운 카드에 붙이고 그 카드를 고른다. 리스너가 최신 값을 보도록 ref 로 둔다.
  const settleRef = useRef(() => {});
  settleRef.current = () => {
    const motion = motionRef.current;
    motion.target = Math.round(motion.target);
    run();
    onSelectPoint(points[normalizeRotation(motion.target, total)].id);
  };

  // ── 배치 ──
  let cardW = clamp(width * 0.24, 150, 250);
  const rx = Math.max(140, Math.min(width / 2 - cardW * 0.45 - 16, 440));
  let ry = rx * TILT;
  const fixedH = LABEL_H + 16 + CAPTION_H + CONTROL_H + 24;
  const flexibleH = (cardW / CARD_RATIO) * (BACK_SCALE / 2 + 0.5) + 2 * ry;
  // 낮은 창에서는 카드와 고리를 함께 줄인다. 넘치느니 작아지는 편이 낫다.
  if (flexibleH > height - fixedH) {
    const shrink = Math.max(0.55, (height - fixedH) / flexibleH);
    cardW *= shrink;
    ry *= shrink;
  }
  const cardH = cardW / CARD_RATIO;
  const systemH = LABEL_H + 16 + (cardH * BACK_SCALE) / 2 + 2 * ry + cardH / 2 + CAPTION_H + CONTROL_H;
  const top = Math.max(12, (height - systemH) / 2);
  const centerX = width / 2;
  const centerY = top + LABEL_H + 16 + (cardH * BACK_SCALE) / 2 + ry;
  const planetSize = clamp(rx * 0.4, 96, 156);

  const gap = total > 0 ? Math.max(MIN_GAP, (2 * Math.PI) / total) : 0;
  /** 고리가 다 차면 모든 카드가 보이고, 넘치면 뒤편 끝에서 카드가 서서히 들고 난다. */
  const fullRing = total * gap <= 2 * Math.PI + 1e-6;
  /** 끌기 거리 → 회전량. 정면에서 카드 한 장이 지나가는 호의 길이쯤. */
  const pxPerCard = Math.max(90, rx * gap * 0.8);

  // 휠 — 트랙패드는 조금씩, 마우스는 한 칸씩 돌고, 멈추면 가장 가까운 카드에 붙는다.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = rootRef.current;
    if (!element || total < 2) return;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const onWheel = (event: WheelEvent) => {
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (Math.abs(delta) < 1) return;
      // React 의 onWheel 은 passive 라 막을 수 없다 — 페이지가 같이 스크롤되지 않게 직접 건다.
      event.preventDefault();
      motionRef.current.target += clamp(delta / 160, -1, 1);
      run();
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => settleRef.current(), 140);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', onWheel);
      if (settleTimer) clearTimeout(settleTimer);
    };
  }, [total, run]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || total < 2) return;
    suppressClickRef.current = false;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startValue: motionRef.current.value,
      lastX: event.clientX,
      lastTime: event.timeStamp,
      velocity: 0,
      active: false,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    if (!drag.active) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return;
      // 누르는 순간 잡지 않는다 — 잡으면 카드 click 이 카드에 가지 않는다.
      drag.active = true;
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    }
    // 이벤트가 몰려 오면 dt 가 0 에 가까워 속도가 튄다 — 한 프레임 아래로는 재지 않는다.
    const dt = Math.max(8, event.timeStamp - drag.lastTime);
    const instant = -(event.clientX - drag.lastX) / pxPerCard / dt;
    drag.velocity = drag.velocity * 0.6 + instant * 0.4;
    drag.lastX = event.clientX;
    drag.lastTime = event.timeStamp;
    const motion = motionRef.current;
    // 오른쪽으로 끌면 카드도 오른쪽으로 — 왼쪽 카드가 정면으로 온다.
    motion.value = drag.startValue - dx / pxPerCard;
    motion.target = motion.value;
    drawFrame();
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (!drag.active) return;
    suppressClickRef.current = true;
    setDragging(false);
    const motion = motionRef.current;
    // 멈춘 채로 놓으면 관성 없이 그 자리에서 붙는다.
    const fling = event.timeStamp - drag.lastTime > 90 ? 0 : clamp(drag.velocity * FLING_MS, -FLING_MAX, FLING_MAX);
    motion.target = Math.round(motion.value + fling);
    run();
    onSelectPoint(points[normalizeRotation(motion.target, total)].id);
  };

  const value = motionRef.current.value;
  const frontIndex = total > 0 ? normalizeRotation(Math.round(value), total) : -1;
  const front = frontIndex >= 0 ? points[frontIndex] : null;
  /** 두 카드 사이를 지나는 중이면 설명을 잠시 지운다 — 어느 카드의 설명인지 헷갈리지 않게. */
  const captionOpacity = clamp(1 - Math.abs(value - Math.round(value)) * 3, 0, 1);

  const openOrSelect = (point: OrbitPoint) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    // 이미 정면에 고른 카드를 한 번 더 누르면 그 탭을 연다.
    if (point.id === selectedPointId) window.open(point.url, '_blank', 'noopener,noreferrer');
    else onSelectPoint(point.id);
  };

  const step = (direction: 1 | -1) => {
    if (total < 2) return;
    onSelectPoint(points[normalizeRotation(frontIndex + direction, total)].id);
  };

  const ringBack = `M ${-rx} 0 A ${rx} ${ry} 0 0 1 ${rx} 0`;
  const ringFront = `M ${rx} 0 A ${rx} ${ry} 0 0 1 ${-rx} 0`;
  const orbitPath = `M ${rx} 0 A ${rx} ${ry} 0 1 1 ${-rx} 0 A ${rx} ${ry} 0 1 1 ${rx} 0`;
  /*
   * 고리를 따라 천천히 흐르는 입자. 앞·뒤 두 층에 같은 입자를 그리고 각 층의 절반만
   * 보이게 잘라, 옆을 돌아 나올 때 층이 바뀌어도 이어져 보이게 한다.
   */
  const dust = (half: 'back' | 'front') => (
    <g clipPath={`url(#oc-${half})`} className="oc-dust">
      <clipPath id={`oc-${half}`}>
        <rect x={-rx - 40} y={half === 'back' ? -ry - 40 : 0} width={2 * rx + 80} height={ry + 40} />
      </clipPath>
      {DUST.map((start, index) => (
        <circle key={start} r={index % 3 === 0 ? 2.2 : 1.5}>
          <animateMotion dur={`${DUST_SECONDS}s`} begin={`${-start * DUST_SECONDS}s`} repeatCount="indefinite" path={orbitPath} />
        </circle>
      ))}
    </g>
  );
  const ring = (path: string, light: string, half: 'back' | 'front') => (
    <>
      <path className="oc-haze" d={path} />
      <path className="oc-ring oc-ring--tint" d={path} />
      <path className="oc-ring oc-ring--light" d={light} />
      {dust(half)}
    </>
  );
  // 흰 줄은 안쪽으로 조금 들인다 — 두 줄이 겹쳐 한 줄로 보이지 않게.
  const lightBack = `M ${-(rx - 3)} 0 A ${rx - 3} ${ry - 1.5} 0 0 1 ${rx - 3} 0`;
  const lightFront = `M ${rx - 3} 0 A ${rx - 3} ${ry - 1.5} 0 0 1 ${-(rx - 3)} 0`;

  return (
    <div
      ref={rootRef}
      className={cx('orbit-carousel', dragging && 'orbit-carousel--dragging')}
      style={{ '--carousel-hue': hue } as React.CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="atlas-planet-label orbit-carousel__label" style={{ left: centerX, top }}>
        <div className="atlas-planet-label__title">{title}</div>
        <div className="atlas-planet-label__meta">{meta}</div>
      </div>

      <svg className="orbit-carousel__ring orbit-carousel__ring--back" width={width} height={height} aria-hidden>
        <g transform={`translate(${centerX}, ${centerY})`}>{ring(ringBack, lightBack, 'back')}</g>
      </svg>

      <button
        type="button"
        className="orbit-carousel__planet"
        style={{ left: centerX, top: centerY }}
        onClick={onClearSelection}
        aria-label={`${title} — 전체 보기`}
      >
        <LivingPlanet size={planetSize} hue={hue} />
      </button>

      <svg className="orbit-carousel__ring orbit-carousel__ring--front" width={width} height={height} aria-hidden>
        <g transform={`translate(${centerX}, ${centerY})`}>{ring(ringFront, lightFront, 'front')}</g>
      </svg>

      {points.map((point, index) => {
        // 정면에서 몇 칸 떨어졌는지 — 고리를 따라 가까운 쪽으로 잰다.
        let offset = normalizeRotation(index - value, total);
        if (offset > total / 2) offset -= total;
        const phi = offset * gap;
        if (Math.abs(phi) > Math.PI) return null;

        const depth = Math.cos(phi);
        const near = (depth + 1) / 2;
        const edge = fullRing ? 1 : clamp((Math.PI - Math.abs(phi)) / (gap * 0.75), 0, 1);
        if (edge <= 0.01) return null;

        const x = rx * Math.sin(phi);
        const y = ry * depth;
        const scale = BACK_SCALE + (1 - BACK_SCALE) * near ** 1.25;
        // 고리를 따라 비스듬히 선다. 옆으로 갈수록 기울지만 끝까지 눕지는 않는다.
        const rotate = Math.sin(phi) * 34;
        // 앞쪽 반은 행성(40)·앞 고리(45) 위에, 뒤쪽 반은 그 밑에 깔린다.
        const zIndex = depth >= 0 ? 50 + Math.round(near * 40) : 10 + Math.round(near * 40);
        const hidden = edge < 0.3;

        return (
          <button
            key={point.id}
            type="button"
            className={cx(
              'orbit-card',
              index === frontIndex && 'orbit-card--front',
              point.id === selectedPointId && 'orbit-card--selected',
            )}
            style={{
              left: centerX,
              top: centerY,
              width: cardW,
              height: cardH,
              zIndex,
              opacity: edge,
              transform: `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale}) perspective(1000px) rotateY(${rotate}deg)`,
              '--fog': (1 - near) * 0.62,
              pointerEvents: hidden ? 'none' : undefined,
            } as React.CSSProperties}
            onClick={() => openOrSelect(point)}
            aria-label={`${index + 1}. ${point.title}`}
            aria-current={point.id === selectedPointId ? 'true' : undefined}
            title={point.id === selectedPointId ? '한 번 더 누르면 새 탭에서 열어요' : undefined}
            {...(hidden ? { 'aria-hidden': true, tabIndex: -1 } : null)}
          >
            <span className="orbit-card__frame">
              <PagePreview url={point.url} title={point.title} width={cardW} />
              <span className="orbit-card__fog" />
            </span>
          </button>
        );
      })}

      {front && (
        <div
          className="orbit-carousel__caption"
          style={{ left: centerX, top: centerY + ry + cardH / 2 + 14, opacity: captionOpacity }}
        >
          <div className="orbit-carousel__caption-title">
            <PageFavicon url={front.url} domain={front.domain} className="orbit-carousel__favicon" />
            <span>{front.title}</span>
          </div>
          <div className="orbit-carousel__caption-meta">
            {front.domain.toLowerCase()}
            {front.minutes > 0 && ` · ${formatMinutes(front.minutes)} 머묾`}
            {front.visits > 1 && ` · ${front.visits}회 방문`}
          </div>
        </div>
      )}

      {total > 1 && (
        <div className="atlas-rotate orbit-carousel__control" style={{ left: centerX, top: centerY + ry + cardH / 2 + CAPTION_H + 8 }}>
          <button type="button" aria-label="이전 페이지" onClick={() => step(-1)}>
            <i className="ph ph-caret-left" />
          </button>
          <span className="atlas-rotate__count">
            {frontIndex + 1} / {total}
          </span>
          <button type="button" aria-label="다음 페이지" onClick={() => step(1)}>
            <i className="ph ph-caret-right" />
          </button>
        </div>
      )}
    </div>
  );
}
