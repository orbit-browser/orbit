import { useLayoutEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { OrbitPoint, SessionNode } from './data';

const cx = (...classes: (string | false | undefined | null)[]) => classes.filter(Boolean).join(' ');

/** 지금 세션의 그룹(폴더, 없으면 "정리 안 된 세션")과 이웃 그룹 이름 */
export interface RailGroup {
  name: string;
  sessions: SessionNode[];
  prev: string | null;
  next: string | null;
}

/** 이웃한 점 사이 간격(px) */
const DOT_GAP = 34;
/** 가운데에서 이만큼(칸)까지 또렷하고, 그 바깥 한 칸 동안 사라진다 */
const DOT_REACH = 3.5;
/** 묶음 안 세션 한 줄의 높이. 지금 줄이 늘 가운데 칸에 온다. */
const ROW_H = 30;

/** 가운데에서 offset 칸 떨어진 점의 모양 — 가운데가 크고 진하며 멀수록 옅어진다. */
function dotStyle(offset: number) {
  const reach = Math.min(1, Math.max(0, DOT_REACH + 1 - Math.abs(offset)));
  const near = Math.max(0, 1 - Math.abs(offset));
  return {
    transform: `translateX(${offset * DOT_GAP}px) scale(${1 + near * 0.8})`,
    opacity: reach * (0.45 + 0.55 * near),
  };
}

/**
 * 점들을 지금 위치(가운데 페이지의 연속 인덱스)에 맞춰 놓는다 — 예전 궤도처럼 고른 페이지가
 * 늘 가운데에 오고, 넘기면 양옆으로 흘러간다. 갤러리처럼 끝이 있다(페이지 수만큼만 점).
 */
function placeDots(dots: (HTMLElement | null)[], position: number) {
  dots.forEach((dot, index) => {
    if (!dot) return;
    const { transform, opacity } = dotStyle(index - position);
    dot.style.transform = transform;
    dot.style.opacity = String(opacity);
  });
}

interface AtlasRailProps {
  title: string;
  hue: string;
  points: OrbitPoint[];
  selectedPointId: string | null;
  onSelectPoint: (pointId: string) => void;
  /** 지금 세션의 그룹. 없으면 지금 세션 한 줄만 그린다. */
  group: RailGroup | null;
  currentSessionId: string;
  onSelectSession: (sessionId: string) => void;
  /** 이전·다음 그룹으로(그 그룹의 첫 세션). Shift+↑↓ 와 같다. */
  onStepGroup: (direction: 1 | -1) => void;
  /** 갤러리가 프레임마다 위치를 넘겨 주는 통로. 막대가 여기에 점 배치 함수를 건다. */
  positionRef: MutableRefObject<(position: number) => void>;
}

/**
 * 갤러리 위의 일자 막대 — 예전 궤도를 곧게 편 것이다(대표 2026-10-20).
 *
 * 가운데 줄이 지금 세션이다. 점 하나가 페이지 하나이고, 고른 페이지가 늘 가운데에 온다.
 * 점을 누르거나 막대를 옆으로 끌면 페이지를 옮기고, 갤러리를 끌면 점도 함께 돈다.
 * 위·아래 줄은 같은 그룹의 다른 세션이다 — 누르거나 ↑↓ 로 옮겨 가면 줄들이 미끄러져 지금
 * 세션이 다시 가운데 줄에 선다. 그룹 사이 이동은 따로다: 그룹 이름 옆 ⌃⌄ 단추와 Shift+↑↓.
 */
export function AtlasRail({
  title,
  hue,
  points,
  selectedPointId,
  onSelectPoint,
  group,
  currentSessionId,
  onSelectSession,
  onStepGroup,
  positionRef,
}: AtlasRailProps) {
  const total = points.length;
  // 아직 아무것도 고르지 않았으면 갤러리 가운데의 첫 페이지가 지금 자리다.
  const selectedIndex = Math.max(0, points.findIndex((point) => point.id === selectedPointId));
  const dotRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const dragRef = useRef<{ pointerId: number; startX: number; startIndex: number; moved: boolean } | null>(null);

  // 세션이 바뀌면 가운데 줄의 점이 새 요소라 다시 건다. 고른 페이지가 바뀔 때는 다시 놓지 않는다 —
  // 그 뒤로는 갤러리가 프레임마다 위치를 넘겨 준다.
  useLayoutEffect(() => {
    const dots = () => dotRefs.current.slice(0, total);
    placeDots(dots(), selectedIndex);
    positionRef.current = (position) => placeDots(dots(), position);
    return () => {
      positionRef.current = () => {};
    };
  }, [total, positionRef, currentSessionId]);

  const rows = group?.sessions ?? [];
  const currentRow = Math.max(0, rows.findIndex((session) => session.id === currentSessionId));
  const stacked = rows.length > 0;

  const currentTrack = (
    <div
      className="atlas-rail__track"
      onPointerDown={(event) => {
        if (event.button !== 0 || total < 2) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startIndex: selectedIndex, moved: false };
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        // 막대를 왼쪽으로 끌면 뒤 페이지가 가운데로 온다 — 고리를 손으로 돌리는 셈이다.
        const steps = Math.round((drag.startX - event.clientX) / DOT_GAP);
        if (steps !== 0) drag.moved = true;
        const index = Math.min(total - 1, Math.max(0, drag.startIndex + steps));
        if (points[index].id !== selectedPointId) onSelectPoint(points[index].id);
      }}
      onPointerUp={(event) => {
        const drag = dragRef.current;
        dragRef.current = null;
        if (!drag || drag.moved) return;
        // 끌지 않고 눌렀으면 누른 점으로 간다.
        const index = Number((event.target as HTMLElement).dataset.index);
        if (Number.isInteger(index) && points[index].id !== selectedPointId) onSelectPoint(points[index].id);
      }}
      onPointerCancel={() => {
        dragRef.current = null;
      }}
    >
      <span className="atlas-rail__line" />
      {points.map((point, index) => (
        <span
          key={point.id}
          ref={(element) => {
            dotRefs.current[index] = element;
          }}
          className="atlas-rail__dot"
          data-index={index}
          title={`${index + 1}. ${point.title}`}
        />
      ))}
    </div>
  );

  return (
    <div className="atlas-rail" style={{ '--rail-hue': hue } as React.CSSProperties}>
      {group && (
        <div className="atlas-rail__group">
          <span>
            {group.name} · 세션 {rows.length}개
          </span>
          <button
            type="button"
            className="atlas-rail__group-step"
            onClick={() => onStepGroup(-1)}
            disabled={!group.prev}
            title={group.prev ? `이전 그룹: ${group.prev} (Shift+↑)` : undefined}
            aria-label={group.prev ? `이전 그룹으로: ${group.prev}` : '이전 그룹 없음'}
          >
            <i className="ph ph-caret-up" />
          </button>
          <button
            type="button"
            className="atlas-rail__group-step"
            onClick={() => onStepGroup(1)}
            disabled={!group.next}
            title={group.next ? `다음 그룹: ${group.next} (Shift+↓)` : undefined}
            aria-label={group.next ? `다음 그룹으로: ${group.next}` : '다음 그룹 없음'}
          >
            <i className="ph ph-caret-down" />
          </button>
        </div>
      )}
      {/* 그룹이 바뀌면 줄 묶음을 새로 세운다(key) — 다른 그룹의 줄이 미끄러져 지나가지 않게. */}
      <div className="atlas-rail__window" key={group?.name ?? 'single'}>
        <div
          className="atlas-rail__stack"
          style={{ transform: `translateY(${(1 - (stacked ? currentRow : 0)) * ROW_H}px)` }}
        >
          {stacked ? (
            rows.map((session, index) => {
              const distance = Math.abs(index - currentRow);
              const current = index === currentRow;
              return (
                <div
                  key={session.id}
                  className={cx('atlas-rail__row', current && 'atlas-rail__row--current')}
                  style={{ opacity: current ? 1 : distance === 1 ? 0.5 : 0 }}
                  {...(current
                    ? null
                    : {
                        role: 'button',
                        tabIndex: distance === 1 ? 0 : -1,
                        'aria-label': `세션으로 이동: ${session.title}`,
                        onClick: () => onSelectSession(session.id),
                        onKeyDown: (event: React.KeyboardEvent) => {
                          if (event.key === 'Enter' || event.key === ' ') onSelectSession(session.id);
                        },
                      })}
                >
                  <span className="atlas-rail__title" title={session.title}>{session.title}</span>
                  {current ? (
                    currentTrack
                  ) : (
                    <div className="atlas-rail__track" style={{ '--rail-hue': session.hue } as React.CSSProperties}>
                      <span className="atlas-rail__line" />
                      {session.pages.map((page, pageIndex) => (
                        <span
                          key={page.id}
                          className="atlas-rail__dot"
                          style={(() => {
                            const { transform, opacity } = dotStyle(pageIndex);
                            return { transform, opacity: opacity * 0.7 };
                          })()}
                        />
                      ))}
                    </div>
                  )}
                  <span className="atlas-rail__count">
                    {current ? `${selectedIndex + 1} / ${total}` : `${session.pages.length}p`}
                  </span>
                </div>
              );
            })
          ) : (
            <div className="atlas-rail__row atlas-rail__row--current">
              <span className="atlas-rail__title" title={title}>{title}</span>
              {currentTrack}
              <span className="atlas-rail__count">
                {selectedIndex + 1} / {total}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
