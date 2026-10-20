/**
 * 2번 현수막의 3D 세션 갤러리 — 새 탭 아틀라스의 세션 갤러리(AtlasGallery.tsx, 원본 Lumière Archive)에서 출발했다.
 *
 * 같은 것: 가운데서 멀어질수록 뒤로 물러나고(translateZ −p²) 돌며(rotateY p) 옅어지는 식, 끌기 ×1.5,
 * 관성 0.95, 놓으면 가장 가까운 카드에 붙기, 페이지가 셋 이상이면 끝없이 도는 고리(ringDelta).
 * 다른 것: 현수막은 950mm 폭이라 카드를 겹쳐 펼친다(간격 < 카드 폭). 고른 카드가 앞으로 나오고 둘레는 흐려진다.
 * 정적 출력(인쇄)에서는 루프 없이 고른 카드 한 프레임만 그린다.
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { alignOffset, normalizeRotation, ringDelta } from '../../entrypoints/newtab/components/atlas/data';
import { shotFor, type ExhibitSession } from './content';
import { Favicon, PagePlaceholder } from './frame';

/** 현수막 단위(1 = 1mm). 값을 바꾸면 화면과 인쇄가 함께 바뀐다. 카드 크기는 exhibition.css(.ex-gcard) */
export const GALLERY = {
  spacing: 250,
  /** p = 거리 / divisor. 아틀라스의 (뷰포트 폭 / 1.5) 자리 */
  divisor: 680,
  depth: 900,
  rotate: 50,
  /** 고른 카드를 앞으로 당기는 양 */
  lift: 190,
  perspective: 1700,
  /** 카메라가 갤러리 가운데보다 이만큼 위에 있다 — 멀어지는 양옆 카드가 올라가 궤도의 앞호가 된다 */
  eyeAbove: 380,
};

const FRICTION = 0.95;
const DRAG_SLOP = 5;
const SEAM = 0.5;

interface Pose {
  transform: string;
  opacity: number;
  filter: string;
  zIndex: number;
}

/** 가운데 카드에서 away 장 떨어진 카드의 자세. 정적 출력과 애니메이션이 같은 식을 쓴다. */
export function poseFor(away: number, total: number): Pose {
  const offset = away * GALLERY.spacing;
  const p = offset / GALLERY.divisor;
  const near = Math.max(0, 1 - Math.abs(away));
  const seam = total >= 3 ? Math.min(1, Math.max(0, (total / 2 - Math.abs(away)) / SEAM)) : 1;
  const z = -(p ** 2) * GALLERY.depth + GALLERY.lift * near ** 2;
  const dim = Math.min(1, Math.abs(away));
  return {
    transform: `translateX(${offset}px) translateZ(${z}px) rotateY(${p * GALLERY.rotate}deg)`,
    opacity: Math.max(0, (1 - Math.abs(p) ** 3) * seam),
    filter: `brightness(${1 - 0.09 * dim}) saturate(${1 - 0.3 * dim}) blur(${Math.min(3, Math.abs(away) * 1.1)}px)`,
    zIndex: 100 - Math.round(Math.abs(away) * 10),
  };
}

function applyPose(element: HTMLElement, pose: Pose) {
  element.style.transform = pose.transform;
  element.style.opacity = String(pose.opacity);
  element.style.filter = pose.filter;
  element.style.zIndex = String(pose.zIndex);
  element.style.visibility = pose.opacity < 0.01 ? 'hidden' : 'visible';
}

interface SessionGalleryProps {
  session: ExhibitSession;
  selected: number;
  onSelect: (index: number) => void;
  /** 끌기·키보드·애니메이션. 끄면 고른 카드의 한 프레임만 그린다(인쇄). */
  interactive: boolean;
  /** 화면에서 현수막이 줄어든 비율 — 끈 거리(px)를 현수막 단위로 바꾼다. */
  scaleRef: RefObject<number>;
}

export function SessionGallery({ session, selected, onSelect, interactive, scaleRef }: SessionGalleryProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const motion = useRef({ current: selected, target: selected, velocity: 0, dragging: false, lastX: 0, moved: 0 });
  const wakeRef = useRef(() => {});
  const total = session.pages.length;
  const latest = useRef({ onSelect, total });
  latest.current = { onSelect, total };

  const place = (position: number) => {
    cardRefs.current.slice(0, total).forEach((card, index) => {
      if (card) applyPose(card, poseFor(total >= 3 ? ringDelta(position, index, total) : index - position, total));
    });
  };

  // 정적 출력 — 고른 카드가 가운데인 한 프레임.
  useLayoutEffect(() => {
    if (interactive) return;
    motion.current.current = motion.current.target = selected;
    place(selected);
  });

  useEffect(() => {
    if (!interactive || total === 0) return;
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    const step = () => {
      const state = motion.current;
      if (!state.dragging) {
        state.target += state.velocity;
        state.velocity *= FRICTION;
      }
      state.current = reduceMotion ? state.target : state.current + (state.target - state.current) * 0.1;
      const settled = !state.dragging && Math.abs(state.target - state.current) < 0.0005 && Math.abs(state.velocity) < 0.0005;
      if (settled) state.current = state.target;
      place(state.current);
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
    // place 는 total 과 카드 ref 만 읽으니 total 이 바뀔 때만 루프를 다시 만든다.
  }, [interactive, total]);

  // 끌기 — 누르기는 갤러리에서, 움직임과 놓기는 창 전체에서(아틀라스와 같다).
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!interactive || !viewport) return;
    const state = motion.current;
    const unit = () => GALLERY.spacing * (scaleRef.current || 1);
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      state.dragging = true;
      state.lastX = event.clientX;
      state.velocity = 0;
      state.moved = 0;
      viewport.classList.add('is-grabbing');
      wakeRef.current();
    };
    const move = (event: PointerEvent) => {
      if (!state.dragging) return;
      const delta = event.clientX - state.lastX;
      state.lastX = event.clientX;
      state.moved += Math.abs(delta);
      state.target -= (delta * 1.5) / unit();
      state.velocity = (-delta * 0.5) / unit();
      wakeRef.current();
    };
    const up = () => {
      if (!state.dragging) return;
      state.dragging = false;
      viewport.classList.remove('is-grabbing');
      if (state.moved <= DRAG_SLOP) return;
      const { total: count, onSelect: select } = latest.current;
      const rest = Math.round(state.target + state.velocity / (1 - FRICTION));
      state.target = count >= 3 ? rest : Math.min(count - 1, Math.max(0, rest));
      state.velocity = 0;
      wakeRef.current();
      select(normalizeRotation(state.target, count));
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
  }, [interactive, scaleRef]);

  // 고른 페이지를 가운데로 — 고리면 가까운 쪽으로 돈다.
  useEffect(() => {
    if (!interactive) return;
    const state = motion.current;
    state.target = total >= 3 ? alignOffset(state.target, selected, total) : selected;
    state.velocity = 0;
    wakeRef.current();
  }, [selected, total, interactive]);

  const go = (step: number) => onSelect(normalizeRotation(selected + step, total));
  const longest = Math.max(1, ...session.pages.map((page) => page.minutes));

  return (
    <div
      className="ex-gallery"
      ref={viewportRef}
      style={{ perspective: `${GALLERY.perspective}px`, perspectiveOrigin: `50% calc(50% - ${GALLERY.eyeAbove}px)`, ['--hue' as string]: session.hue }}
      tabIndex={interactive ? 0 : -1}
      role="group"
      aria-roledescription="세션 갤러리"
      aria-label={`${session.title} — 페이지 ${total}개. 좌우 화살표로 넘긴다`}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') go(1);
        else if (event.key === 'ArrowLeft') go(-1);
        else return;
        event.preventDefault();
      }}
    >
      <OrbitFloor total={total} />
      {session.pages.map((page, index) => {
        const shot = shotFor(page.url);
        const current = index === selected;
        return (
          <div
            key={page.id}
            ref={(element) => {
              cardRefs.current[index] = element;
            }}
            className={`ex-gcard${current ? ' is-current' : ''}`}
            style={{ ['--hue' as string]: session.hue }}
            onClick={() => {
              if (motion.current.moved > DRAG_SLOP) return;
              onSelect(index);
            }}
            aria-current={current ? 'true' : undefined}
            aria-label={`${index + 1}. ${page.title}`}
          >
            <div className="ex-gcard__bar">
              <Favicon url={page.url} domain={page.domain} />
              <span className="ex-gcard__domain">{page.domain}</span>
              <span className="ex-gcard__time">{page.time}</span>
            </div>
            <div className="ex-gcard__shot">
              {shot ? <img src={shot} alt="" draggable={false} /> : <PagePlaceholder />}
            </div>
            <div className="ex-gcard__meta">
              <div className="ex-gcard__title">
                <span>{page.title}</span>
                <em>{String(index + 1).padStart(2, '0')}</em>
              </div>
              <div className="ex-gcard__dwell">
                {/* 체류 막대 — 이 세션에서 가장 오래 본 페이지를 꽉 찬 막대로(아틀라스 트레이와 같다) */}
                <span className="ex-gcard__track">
                  <i style={{ width: `${(page.minutes / longest) * 100}%` }} />
                </span>
                <span>{page.minutes}분 체류</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 바닥의 궤도 — 카드가 서 있는 길(z = −p²·depth)을 바닥에 그린다. 점은 카드가 멈추는 자리다.
 * 바닥 판은 rotateX(90°) 라 판의 y 가 깊이(z)가 된다. 카드 아래 끝(+237)보다 조금 아래에 둔다.
 */
function OrbitFloor({ total }: { total: number }) {
  const reach = 1150;
  const points: string[] = [];
  for (let x = -reach; x <= reach; x += 25) {
    const p = x / GALLERY.divisor;
    points.push(`${x},${(-(p ** 2) * GALLERY.depth).toFixed(1)}`);
  }
  const slots = [-2, -1, 0, 1, 2].filter((away) => total >= 3 || Math.abs(away) < total);
  return (
    <div className="ex-gallery__floor" aria-hidden>
      <svg viewBox={`${-reach} ${-reach} ${reach * 2} ${reach * 2}`} width={reach * 2} height={reach * 2}>
        <defs>
          <radialGradient id="ex-floor-shadow">
            <stop offset="0" stopColor="rgba(150, 95, 70, 0.3)" />
            <stop offset="1" stopColor="rgba(150, 95, 70, 0)" />
          </radialGradient>
        </defs>
        <ellipse cx="0" cy="-120" rx="560" ry="300" fill="url(#ex-floor-shadow)" />
        <polyline className="ex-gallery__orbit" points={points.join(' ')} />
        {slots.map((away) => {
          const x = away * GALLERY.spacing;
          const p = x / GALLERY.divisor;
          return <circle key={away} className={away === 0 ? 'is-on' : undefined} cx={x} cy={-(p ** 2) * GALLERY.depth} r={away === 0 ? 13 : 8} />;
        })}
      </svg>
    </div>
  );
}
