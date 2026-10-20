import { useEffect, useRef } from 'react';
import type { OrbitPoint } from './data';
import { pageShot } from './page-shots';

/**
 * 세션 씬의 페이지 갤러리 — 레퍼런스(Lumière Archive)의 원근 갤러리를 그대로 옮겼다.
 *
 * 카드가 가로로 늘어서고, 가운데서 멀어질수록 뒤로 물러나며(translateZ) 돌고(rotateY)
 * 옅어진다. 끌면 따라오고 놓으면 관성으로 미끄러진다. 값과 계산식은 원본과 같다.
 * 원본과 달리 저절로 흐르지 않는다(대표 2026-10-20) — 끌기·←→·카드·위 막대로만 움직이고,
 * 멈출 때는 가장 가까운 카드에 붙어 그 페이지를 고른다.
 * 사진 대신 페이지 화면을 쓰고, 화면이 없는 페이지는 원본의 빈 사진처럼 회색 칸이다.
 */

/** 카드 한 장이 차지하는 폭(카드 200 + 틈 20) */
const SPACING = 220;
/** 관성 감쇠(프레임마다 남는 속도의 비율). 놓은 뒤 더 가는 거리는 속도 / (1 - FRICTION) 이다. */
const FRICTION = 0.95;
/** 이만큼 넘게 움직였으면 누르기가 아니라 끌기다 */
const DRAG_SLOP = 5;

interface AtlasGalleryProps {
  points: OrbitPoint[];
  selectedPointId: string | null;
  onSelectPoint: (pointId: string) => void;
  /** 프레임마다 지금 위치(가운데 카드의 연속 인덱스)를 알린다 — 위 막대의 점이 따라 돈다. */
  onFrame?: (position: number) => void;
  /** 위 막대가 차지하는 높이. */
  top: number;
  /** 아래 트레이가 차지하는 높이. 갤러리는 그 사이 영역의 가운데에 선다. */
  bottomInset: number;
}

export function AtlasGallery({
  points,
  selectedPointId,
  onSelectPoint,
  onFrame,
  top,
  bottomInset,
}: AtlasGalleryProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const motion = useRef({ current: 0, target: 0, velocity: 0, dragging: false, lastX: 0, moved: 0 });

  /*
   * 원본은 사진 15장이 한 바퀴다. 페이지가 적으면 한 바퀴가 화면보다 짧아 끝의 카드가 반대편으로
   * 튀어 보인다 — 같은 페이지를 이어 붙여 한 바퀴를 원본 길이(15장) 이상으로 만든다.
   */
  const copies = points.length > 0 ? Math.max(1, Math.ceil(15 / points.length)) : 0;
  const cards = Array.from({ length: points.length * copies }, (_, index) => points[index % points.length]);
  const loop = cards.length * SPACING;
  // 창 전체에 건 놓기 핸들러가 최신 카드·콜백을 보도록
  const latest = useRef({ cards, onSelectPoint, onFrame });
  latest.current = { cards, onSelectPoint, onFrame };
  /** 멈춰 있던 프레임 루프를 다시 돌린다. 움직일 일이 생길 때마다 부른다. */
  const wakeRef = useRef(() => {});

  /*
   * 프레임마다 카드 위치를 원본과 같은 식으로 다시 놓는다. 상태 대신 DOM 을 직접 고친다(원본과 같다).
   * 저절로 흐르지 않으니 다 멈추면 루프도 쉰다.
   */
  useEffect(() => {
    if (cards.length === 0) return;
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    const step = () => {
      const state = motion.current;
      if (!state.dragging) {
        state.target += state.velocity;
        state.velocity *= FRICTION;
      }
      state.current = reduceMotion ? state.target : state.current + (state.target - state.current) * 0.1;
      const settled =
        !state.dragging && Math.abs(state.target - state.current) < 0.05 && Math.abs(state.velocity) < 0.05;
      if (settled) state.current = state.target;
      const width = viewportRef.current?.clientWidth ?? window.innerWidth;
      cardRefs.current.forEach((card, index) => {
        if (!card) return;
        // 한 바퀴 길이 안으로 접어 끝없이 돈다
        const offset = ((((index * SPACING - state.current + loop / 2) % loop) + loop) % loop) - loop / 2;
        if (Math.abs(offset) >= width) {
          card.style.display = 'none';
          return;
        }
        const progress = offset / (width / 1.5);
        card.style.display = 'block';
        card.style.transform = `translateX(${offset}px) translateZ(${-(progress ** 2) * 500}px) rotateY(${progress * 45}deg)`;
        card.style.opacity = String(1 - Math.abs(progress) ** 3);
      });
      latest.current.onFrame?.(state.current / SPACING);
      frame = settled ? 0 : requestAnimationFrame(step);
    };
    wakeRef.current = () => {
      if (!frame) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      wakeRef.current = () => {};
    };
  }, [cards.length, loop]);

  // 끌기 — 누르기는 갤러리에서, 움직임과 놓기는 창 전체에서 받는다(원본과 같다).
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const state = motion.current;
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      state.dragging = true;
      state.lastX = event.clientX;
      state.velocity = 0;
      state.moved = 0;
      viewport.style.cursor = 'grabbing';
      wakeRef.current();
    };
    const move = (event: PointerEvent) => {
      if (!state.dragging) return;
      const delta = event.clientX - state.lastX;
      state.lastX = event.clientX;
      state.moved += Math.abs(delta);
      state.target -= delta * 1.5;
      state.velocity = -delta * 0.5;
      wakeRef.current();
    };
    const up = () => {
      if (!state.dragging) return;
      state.dragging = false;
      viewport.style.cursor = 'grab';
      if (state.moved <= DRAG_SLOP) return;
      // 관성이 멈출 자리를 미리 셈해 가장 가까운 카드에 붙이고, 그 페이지를 고른다.
      const index = Math.round((state.target + state.velocity / (1 - FRICTION)) / SPACING);
      state.target = index * SPACING;
      state.velocity = 0;
      wakeRef.current();
      const { cards: current, onSelectPoint: select } = latest.current;
      if (current.length > 0) select(current[((index % current.length) + current.length) % current.length].id);
    };
    viewport.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      viewport.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  // 고른 페이지를 가운데로 — 이어 붙인 사본 중 지금 향하는 자리에서 가장 가까운 카드로 간다.
  const centeredRef = useRef(false);
  useEffect(() => {
    if (!selectedPointId || loop === 0) return;
    const state = motion.current;
    let best = Number.POSITIVE_INFINITY;
    for (let index = 0; index < cards.length; index += 1) {
      if (cards[index].id !== selectedPointId) continue;
      const offset = ((((index * SPACING - state.target + loop / 2) % loop) + loop) % loop) - loop / 2;
      if (Math.abs(offset) < Math.abs(best)) best = offset;
    }
    if (!Number.isFinite(best)) return;
    state.target += best;
    state.velocity = 0;
    // 처음 열 때는 미끄러지지 않고 그 자리에서 시작한다.
    if (!centeredRef.current) state.current = state.target;
    centeredRef.current = true;
    wakeRef.current();
    // cards 는 렌더마다 points 에서 새로 만든다 — 고른 페이지가 바뀔 때만 다시 맞춘다.
  }, [selectedPointId, loop]);

  return (
    <div className="atlas-gallery" ref={viewportRef} style={{ top, bottom: bottomInset }}>
      <div className="atlas-gallery__strip">
        {cards.map((point, index) => {
          const shot = pageShot(point.url);
          const copy = index >= points.length;
          return (
            <button
              key={index}
              ref={(element) => {
                cardRefs.current[index] = element;
              }}
              type="button"
              className="atlas-gallery__card"
              onClick={() => {
                // 끌다가 놓은 자리의 click 은 누르기가 아니다.
                if (motion.current.moved > DRAG_SLOP) return;
                onSelectPoint(point.id);
              }}
              title={point.title}
              aria-label={`${(index % points.length) + 1}. ${point.title}`}
              aria-current={point.id === selectedPointId && !copy ? 'true' : undefined}
              {...(copy ? { 'aria-hidden': true, tabIndex: -1 } : null)}
            >
              {shot && <img src={shot} alt="" draggable={false} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
