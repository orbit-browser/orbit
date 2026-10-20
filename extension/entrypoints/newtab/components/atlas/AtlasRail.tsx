import { useLayoutEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { OrbitPoint, SessionNode } from './data';
import { ringDelta } from './data';

const cx = (...classes: (string | false | undefined | null)[]) => classes.filter(Boolean).join(' ');

/** 이웃한 점 사이 간격(px) */
const DOT_GAP = 34;
/** 가운데에서 이만큼(칸)까지 또렷하고, 그 바깥 한 칸 동안 사라진다 */
const DOT_REACH = 3.5;
/** 묶음 안 세션 한 줄의 높이. 지금 줄이 늘 가운데 칸에 온다. */
const ROW_H = 30;

/**
 * 점들을 지금 위치(가운데 페이지의 연속 인덱스)에 맞춰 놓는다 — 예전 궤도처럼 고른 페이지가
 * 늘 가운데에 오고, 넘기면 고리가 돌듯 양옆으로 흘러간다.
 *
 * 링이 감기는 자리(반대편 끝)에선 점이 다 사라져 있게 해 순간이동이 보이지 않게 한다.
 */
function placeDots(dots: (HTMLElement | null)[], position: number) {
  const total = dots.length;
  dots.forEach((dot, index) => {
    if (!dot) return;
    const offset = ringDelta(position, index, total);
    const wrap = Math.min(1, Math.max(0, (total / 2 - Math.abs(offset)) * 2));
    const reach = Math.min(1, Math.max(0, DOT_REACH + 1 - Math.abs(offset)));
    const near = Math.max(0, 1 - Math.abs(offset));
    dot.style.transform = `translateX(${offset * DOT_GAP}px) scale(${1 + near * 0.8})`;
    dot.style.opacity = String(Math.min(wrap, reach) * (0.45 + 0.55 * near));
  });
}

interface AtlasRailProps {
  title: string;
  hue: string;
  points: OrbitPoint[];
  selectedPointId: string | null;
  onSelectPoint: (pointId: string) => void;
  /** 지금 세션이 속한 묶음. 없으면 지금 세션 한 줄만 그린다. */
  group: { name: string; sessions: SessionNode[] } | null;
  currentSessionId: string;
  onSelectSession: (sessionId: string) => void;
  /** 갤러리가 프레임마다 위치를 넘겨 주는 통로. 막대가 여기에 점 배치 함수를 건다. */
  positionRef: MutableRefObject<(position: number) => void>;
}

/**
 * 갤러리 위의 일자 막대 — 예전 궤도를 곧게 편 것이다(대표 2026-10-20).
 *
 * 가운데 줄이 지금 세션이다. 점 하나가 페이지 하나이고, 고른 페이지가 늘 가운데에 온다.
 * 점을 누르거나 막대를 옆으로 끌면 페이지를 옮기고, 갤러리를 끌면 점도 함께 돈다.
 * 위·아래 줄은 같은 묶음(폴더) 안의 다른 세션이다 — 누르거나 ↑↓ 로 옮겨 가면 줄들이
 * 미끄러져 지금 세션이 다시 가운데 줄에 선다.
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
  positionRef,
}: AtlasRailProps) {
  const total = points.length;
  // 아직 아무것도 고르지 않았으면 갤러리 가운데의 첫 페이지가 지금 자리다.
  const selectedIndex = Math.max(0, points.findIndex((point) => point.id === selectedPointId));
  const dotRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const dragRef = useRef<{ pointerId: number; startX: number; startIndex: number; moved: boolean } | null>(null);

  useLayoutEffect(() => {
    const dots = dotRefs.current.slice(0, total);
    placeDots(dots, selectedIndex);
    positionRef.current = (position) => placeDots(dots, position);
    return () => {
      positionRef.current = () => {};
    };
    // 고른 페이지가 바뀌어도 다시 놓지 않는다 — 그 뒤로는 갤러리가 프레임마다 위치를 넘겨 준다.
  }, [total, positionRef]);

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
        const index = (((drag.startIndex + steps) % total) + total) % total;
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
      {stacked && (
        <div className="atlas-rail__group">
          {group?.name} · 세션 {rows.length}개
        </div>
      )}
      <div className="atlas-rail__window">
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
                            const offset = ringDelta(0, pageIndex, session.pages.length);
                            const fade = Math.min(1, Math.max(0, DOT_REACH + 1 - Math.abs(offset)));
                            const wrap = Math.min(1, Math.max(0, (session.pages.length / 2 - Math.abs(offset)) * 2));
                            return {
                              transform: `translateX(${offset * DOT_GAP}px) scale(${1 + Math.max(0, 1 - Math.abs(offset)) * 0.8})`,
                              opacity: Math.min(fade, wrap) * 0.7,
                            };
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
