/**
 * 실제 화면 시안(?variant=span, 대표 2026-10-23) — 가운데 벽 세 장(3·4·5번)에 실제 새 탭과 사이드패널을 크롬 창 하나로
 * 이어 건다. 화면은 span-scene.html 을 iframe 으로 띄운 실제 컴포넌트(미리보기 대역의 합성 데이터)라 인쇄 PDF 에서도
 * 글자가 벡터로 나간다. 강조 표시(상자·원·화살표·돋보기·라벨)는 장면이 보내 준 요소 자리에 붙인다.
 *
 * 세 장은 같은 장면을 하나씩 띄워 자기 몫만 보인다(벽 좌표 − 장의 자리). 장 사이 기둥(40mm)에 걸리는 몫은 가려진다.
 * 홈 대화 칸(920px)이 4번 장 안에 들어가게 크기를 잡았고, 네비게이터와 사이드패널 폭을 같게 둬서 장 경계가
 * 빈 바탕에 떨어진다. 핵심 문구(제목·라벨·숫자)는 장마다 안전 여백 안에만 둔다.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { BOOTH } from './booth';
import { BannerFrame } from './frame';
import { PROVEN_NOTE, PROVEN_STATS, ProvenStat } from './panel-tech';
import type { SpanMessage, SpanRect, SpanTargets } from './span-scene';

/** 장면 크기와 자리. 1 장면 px = scale mm. 폭은 3번 장 왼쪽 안전선(50)부터 5번 장 오른쪽 안전선(2,880)까지. */
const SPAN = {
  scale: 0.96,
  width: 2948,
  height: 1240,
  side: 380,
  nav: 380,
  left: 50,
  top: 600,
};

/**
 * 돋보기 — 사이드패널의 열기·공유 단추를 zoom 배 더 키워 5번 장 빈 바탕에 보인다. 단추보다 dy 만큼 아래에 둬서
 * 위 라벨이 창의 탭 줄에 걸리지 않게 한다.
 */
const LENS = { x: 2272, dy: 150, radius: 230, zoom: 2 };

const STEP = 950 + BOOTH.post;
const SCENE_URL = `./span-scene.html?w=${SPAN.width}&h=${SPAN.height}&side=${SPAN.side}&nav=${SPAN.nav}`;

type Box = { x: number; y: number; w: number; h: number };

/** 장면 px → 벽 mm */
const toWall = (rect: SpanRect, pad = 0): Box => ({
  x: SPAN.left + (rect.x - pad) * SPAN.scale,
  y: SPAN.top + (rect.y - pad) * SPAN.scale,
  w: (rect.width + pad * 2) * SPAN.scale,
  h: (rect.height + pad * 2) * SPAN.scale,
});

const unionRect = (a: SpanRect, b: SpanRect): SpanRect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
};

interface Callout {
  no: number;
  title: string;
  text: string;
  /** 라벨 자리(벽 mm, 왼쪽 위)와 폭 */
  at: { x: number; y: number; w: number };
  /** 라벨에서 표시까지 화살표(벽 mm) */
  from: [number, number];
  to: [number, number];
}

interface Circle {
  x: number;
  y: number;
  r: number;
}

interface Layout {
  boxes: Box[];
  ring: Circle;
  lens: Circle & { focus: { x: number; y: number } };
  /** 돋보기와 단추 원을 잇는 바깥 접선 두 개 */
  ties: [number, number, number, number][];
  pills: Box[];
  callouts: Callout[];
}

/** 두 원의 바깥 접선(두 원을 함께 감싸는 줄). 원 a 가 원 b 보다 크다. */
function outerTangents(a: Circle, b: Circle): [number, number, number, number][] {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const spread = Math.acos((a.r - b.r) / Math.hypot(b.x - a.x, b.y - a.y));
  return [angle + spread, angle - spread].map((t) => [
    a.x + a.r * Math.cos(t),
    a.y + a.r * Math.sin(t),
    b.x + b.r * Math.cos(t),
    b.y + b.r * Math.sin(t),
  ]);
}

/** 장면이 잰 요소 자리로 강조 표시를 놓는다. 라벨은 3번 장(①②)과 5번 장(③④)의 빈 바탕, 안전 여백 안에 둔다. */
export function layoutFor(targets: SpanTargets): Layout | null {
  const { question, answer, source, reopen, share } = targets;
  if (!question || !answer || !source || !reopen || !share) return null;
  const ask = toWall(unionRect(question, answer), 14);
  const card = toWall(source, 10);
  const buttons = unionRect(reopen, share);
  const focus = { x: buttons.x + buttons.width / 2, y: buttons.y + buttons.height / 2 };
  const target = toWall({ x: focus.x, y: focus.y, width: 0, height: 0 });
  const lens = { x: LENS.x, y: target.y + LENS.dy, r: LENS.radius, focus };
  const ring = { x: target.x, y: target.y, r: (buttons.width / 2) * SPAN.scale + 22 };
  const zoom = SPAN.scale * LENS.zoom;
  // 돋보기 안의 단추 자리 — 초점에서 떨어진 만큼 zoom 배로. 두 단추가 2px 붙어 있어 마주 보는 쪽은 줄여 테두리를 띄운다
  const inLens = (rect: SpanRect, left: number, right: number): Box => ({
    x: lens.x + (rect.x - left - focus.x) * zoom,
    y: lens.y + (rect.y - 5 - focus.y) * zoom,
    w: (rect.width + left + right) * zoom,
    h: (rect.height + 10) * zoom,
  });
  const pills = [inLens(reopen, 6, -2), inLens(share, -2, 6)];
  // 라벨 화살표는 돋보기 테두리에서 멈춘다(돋보기가 위에 덮인다) — 단추 바로 위·아래의 테두리 점
  const rim = (x: number, side: -1 | 1) => lens.y + side * (Math.sqrt(lens.r ** 2 - (x - lens.x) ** 2) + 10);
  const [reopenX, shareX] = pills.map((pill) => pill.x + pill.w / 2);
  const labelW = 420;
  const leftX = 470;
  const rightX = 2040;
  return {
    boxes: [ask, card],
    ring,
    lens,
    ties: outerTangents(lens, ring),
    pills,
    callouts: [
      {
        no: 1,
        title: '생각나는 대로 물어도 찾아 줍니다',
        text: '제목을 몰라도, 그때 하던 일을 적으면 그\u00a0세션을 찾아 답합니다.',
        at: { x: leftX, y: ask.y + ask.h / 2 - 96, w: labelW },
        from: [leftX + labelW + 6, ask.y + ask.h / 2],
        to: [ask.x - 6, ask.y + ask.h / 2],
      },
      {
        no: 2,
        title: '본 페이지는 세션 하나로 묶여 있습니다',
        text: 'AI가 같은 일로 본 페이지를 묶고 제목과 요약을 붙여 둡니다.',
        at: { x: leftX, y: card.y - 8, w: labelW },
        from: [leftX + labelW + 6, card.y + card.h / 2],
        to: [card.x - 6, card.y + card.h / 2],
      },
      {
        no: 3,
        title: '누르면 그때 페이지가 다시 열립니다',
        text: '새 창으로도, 지금 창에도 한 번에 엽니다.',
        at: { x: rightX, y: lens.y - lens.r - 230, w: labelW },
        from: [reopenX, lens.y - lens.r - 52],
        to: [reopenX, rim(reopenX, -1)],
      },
      {
        no: 4,
        title: '팀에는 고른 세션만 공유됩니다',
        text: '팀원은 공유된 세션 안에서만 찾고 묻습니다.',
        at: { x: rightX, y: lens.y + lens.r + 60, w: labelW },
        from: [shareX, lens.y + lens.r + 56],
        to: [shareX, rim(shareX, 1)],
      },
    ],
  };
}

/** 장면 iframe — 화면에서는 그림처럼(누르지 않게), 크기는 장면 px 그대로 두고 scale 로 줄인다. */
function Scene({ frameRef, style }: { frameRef?: React.RefObject<HTMLIFrameElement | null>; style?: CSSProperties }) {
  return (
    <iframe
      ref={frameRef}
      className="ex-span__scene"
      src={SCENE_URL}
      title="실제 Orbit 새 탭과 사이드패널"
      tabIndex={-1}
      aria-hidden
      style={{ width: SPAN.width, height: SPAN.height, ...style }}
    />
  );
}

export function SpanBanner({ part }: { part: 0 | 1 | 2 }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [message, setMessage] = useState<SpanMessage | null>(null);
  const x0 = part * STEP;

  useEffect(() => {
    const take = (data: unknown) => {
      const value = data as SpanMessage | undefined;
      if (value?.kind === 'orbit-span:ready' || value?.kind === 'orbit-span:error') setMessage(value);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source === frameRef.current?.contentWindow) take(event.data);
    };
    window.addEventListener('message', onMessage);
    // 다시 그릴 때 이미 끝난 장면이면 남겨 둔 메시지를 읽는다
    take((frameRef.current?.contentWindow as (Window & { spanMessage?: SpanMessage }) | null)?.spanMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const layout = message?.kind === 'orbit-span:ready' ? layoutFor(message.targets) : null;
  const step = part + 1;
  const label = ['현수막 — 실제 화면 시안 왼쪽', '현수막 — 실제 화면 시안 가운데', '현수막 — 실제 화면 시안 오른쪽'][part];

  return (
    <BannerFrame step={step} label={label}>
      <div className="ex-span__window" style={{ left: SPAN.left - x0, top: SPAN.top, width: SPAN.width * SPAN.scale, height: SPAN.height * SPAN.scale }}>
        <Scene frameRef={frameRef} style={{ transform: `scale(${SPAN.scale})` }} />
        {message?.kind === 'orbit-span:error' && (
          <p className="ex-span__error" role="alert">
            실제 화면을 띄우지 못했습니다 — {message.message}
          </p>
        )}
      </div>

      {layout && <Marks layout={layout} x0={x0} part={part} />}

      {part === 0 && (
        <h1 className="ex-span__question">
          어제 봤던
          <br />그 페이지,
          <br />
          어디 갔지?
        </h1>
      )}
      {part === 1 && (
        <section className="ex-span__brand">
          <h1 className="ex-span__word">
            Orbit<span>.</span>
          </h1>
          <p className="ex-span__promise">본 페이지를 대신 기억해 둬요.</p>
        </section>
      )}
      {part === 2 && (
        <section className="ex-span__real">
          <h1>
            지금 보이는 게
            <br />
            실제 Orbit 화면이에요.
          </h1>
          {/* 행동 유도 — 두 앞 띠·USE 와 같은 말 */}
          <p className="ex-cta">
            <i className="ph ph-arrow-right" />
            지금 써 보세요 · 시연은 가운데 화면에서
          </p>
        </section>
      )}

      <section className="ex-span__proof" aria-label="시험으로 확인한 숫자">
        <ProvenStat stat={PROVEN_STATS[part]} />
      </section>
      <p className="ex-fineprint ex-span__fineprint">
        {part === 2
          ? PROVEN_NOTE
          : '화면: 실제 Orbit 새 탭(왼쪽 네비게이터를 연 홈, AI에게 질문)과 사이드패널(세션) · 세션과 방문은 시연용 합성 데이터'}
      </p>
    </BannerFrame>
  );
}

/** 벽 좌표의 강조 표시 층 — 장마다 같은 층을 자기 자리만큼 옮겨 그린다(나머지는 현수막 밖이라 잘린다). */
function Marks({ layout, x0, part }: { layout: Layout; x0: number; part: number }) {
  const { boxes, ring, lens, ties, pills, callouts } = layout;
  const marker = `ex-span-arrow-${part}`;
  const zoom = SPAN.scale * LENS.zoom;
  const lensSide = lens.r * 2;
  return (
    <>
      <svg className="ex-span__marks" viewBox={`0 0 2930 ${BOOTH.height}`} style={{ left: -x0 }} aria-hidden>
        <defs>
          <marker id={marker} viewBox="0 0 12 12" refX="10" refY="6" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L12,6 L0,12 z" className="ex-span__arrowhead" />
          </marker>
        </defs>
        {boxes.map((box, index) => (
          <rect key={index} x={box.x} y={box.y} width={box.w} height={box.h} rx="14" className="ex-span__box" />
        ))}
        {/* 돋보기와 사이드패널의 단추를 잇는 두 줄, 단추를 두른 원 */}
        {ties.map(([x1, y1, x2, y2], index) => (
          <line key={index} x1={x1} y1={y1} x2={x2} y2={y2} className="ex-span__tie" />
        ))}
        <circle cx={ring.x} cy={ring.y} r={ring.r} className="ex-span__ring" />
        {callouts.map((callout) => (
          <line
            key={callout.no}
            x1={callout.from[0]}
            y1={callout.from[1]}
            x2={callout.to[0]}
            y2={callout.to[1]}
            className="ex-span__leader"
            markerEnd={`url(#${marker})`}
          />
        ))}
      </svg>

      {/* 돋보기 — 같은 장면을 한 번 더 띄워 zoom 배로 보인다. 5번 장에만 걸리므로 그 장에서만 띄운다 */}
      {lens.x + lens.r > x0 && lens.x - lens.r < x0 + 950 && (
        <div className="ex-span__lens" style={{ left: lens.x - lens.r - x0, top: lens.y - lens.r, width: lensSide, height: lensSide }}>
          <Scene
            style={{
              transform: `translate(${lens.r - lens.focus.x * zoom}px, ${lens.r - lens.focus.y * zoom}px) scale(${zoom})`,
            }}
          />
          <svg viewBox={`${lens.x - lens.r} ${lens.y - lens.r} ${lensSide} ${lensSide}`} aria-hidden>
            {pills.map((pill, index) => (
              <rect key={index} x={pill.x} y={pill.y} width={pill.w} height={pill.h} rx={pill.h / 2} className="ex-span__pill" />
            ))}
          </svg>
        </div>
      )}

      {callouts.map((callout) =>
        callout.at.x + callout.at.w > x0 && callout.at.x < x0 + 950 ? (
          <Label key={callout.no} no={callout.no} style={{ left: callout.at.x - x0, top: callout.at.y, width: callout.at.w }}>
            <strong>{callout.title}</strong>
            <span>{callout.text}</span>
          </Label>
        ) : null,
      )}
    </>
  );
}

function Label({ no, style, children }: { no: number; style: CSSProperties; children: ReactNode }) {
  return (
    <div className="ex-span__label" style={style}>
      <b className="ex-span__no">{no}</b>
      {children}
    </div>
  );
}
