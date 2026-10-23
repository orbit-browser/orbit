/**
 * 실제 화면 시안(?variant=span, 대표 2026-10-23) — 가운데 벽 세 장(3·4·5번)에 실제 새 탭과 사이드패널을 크롬 창 하나로
 * 이어 건다. 화면은 span-scene.html 을 iframe 으로 띄운 실제 컴포넌트(미리보기 대역의 합성 데이터)라 인쇄 PDF 에서도
 * 글자가 벡터로 나간다. 강조 표시(상자·화살표·돋보기·번호 라벨)는 장면이 보내 준 요소 자리에 붙인다.
 *
 * 세 장은 같은 장면을 하나씩 띄워 자기 몫만 보인다(벽 좌표 − 장의 자리). 장 사이 기둥(40mm)에 걸리는 몫은 가려진다.
 * 홈 대화 칸(920px)이 4번 장 안에 들어가게 크기를 잡았고, 네비게이터와 사이드패널 폭을 같게 둬서 장 경계가
 * 빈 바탕에 떨어진다. 핵심 문구(제목·라벨·숫자)는 장마다 안전 여백 안에만 둔다.
 *
 * 높이(디자인팀장 검토 2026-10-23): 현수막은 바닥에 세우고 눈높이는 바닥에서 1.5~1.65m(위에서 730~880mm)다.
 * 창 높이를 줄이면 홈의 빈 위쪽이 줄어 질문·답이 눈높이로 올라온다 — ① 상자 위끝이 바닥에서 약 1.5m, 숫자 띠는
 * 허리(바닥에서 1m) 위에 온다. 아래쪽은 가운데 벽 앞 시연 탁자 높이라 비워 둔다.
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
  height: 740,
  side: 380,
  nav: 380,
  left: 50,
  top: 495,
};

/** 숫자 띠의 위끝(벽 mm) — 창 바로 아래. 띠 아래끝이 바닥에서 1m(위에서 1,380mm)를 넘지 않게 시험이 지킨다. */
export const PROOF_TOP = Math.round(SPAN.top + SPAN.height * SPAN.scale + 14);

/**
 * 돋보기 — 사이드패널의 열기·공유 단추 줄만 zoom 배로 키워 5번 장 빈 바탕에 보인다(알약 모양). 단추 줄 위아래의 목록 글자와
 * 파비콘은 담지 않는다(마케팅·디자인팀장 검토 2026-10-23). x 는 돋보기 가운데(벽 mm), pad 는 단추 둘레 여백(장면 px),
 * lift 는 실제 단추 줄보다 올려 두는 높이(mm) — 아래 라벨(④)이 창 안에 들어오게.
 */
const LENS = { x: 2268, zoom: 2, padX: 10, padY: 8, lift: 46 };

/** 시안의 장 목록 — 가운데 벽 세 장이 한 장(ORBIT)이다. 머리글 번호와 바닥 진행 표시가 이 목록을 따른다(frame.tsx Chapters). */
export const SPAN_CHAPTERS = ['USE', 'ORBIT', 'TEAM'] as const;

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

interface Layout {
  boxes: Box[];
  /** 돋보기(벽 mm)와 그 안에 보일 장면 범위(장면 px) */
  lens: Box & { source: SpanRect };
  /** 사이드패널의 실제 단추 줄을 두른 알약 — 위아래 목록 글자에 닿지 않는다 */
  marker: Box;
  /** 돋보기와 실제 단추 줄을 잇는 두 줄 */
  ties: [number, number, number, number][];
  /** 돋보기 안에서 단추 묶음을 두른 알약과 그 위·아래에 붙는 번호(③ 열기, ④ 공유) */
  pills: Box[];
  badges: { no: number; x: number; y: number }[];
  callouts: Callout[];
}

/** 장면이 잰 요소 자리로 강조 표시를 놓는다. 라벨은 3번 장(①②)과 5번 장(③④)의 빈 바탕, 안전 여백 안에 둔다. */
export function layoutFor(targets: SpanTargets): Layout | null {
  const { question, answer, source, reopen, share } = targets;
  if (!question || !answer || !source || !reopen || !share) return null;
  const ask = toWall(unionRect(question, answer), 14);
  const card = toWall(source, 10);
  const buttons = unionRect(reopen, share);
  const scene = { x: buttons.x - LENS.padX, y: buttons.y - LENS.padY, width: buttons.width + LENS.padX * 2, height: buttons.height + LENS.padY * 2 };
  const zoom = SPAN.scale * LENS.zoom;
  const lensW = scene.width * zoom;
  const lensH = scene.height * zoom;
  const marker = toWall(buttons, 3);
  const lens = { x: LENS.x - lensW / 2, y: marker.y + marker.h / 2 - lensH / 2 - LENS.lift, w: lensW, h: lensH, source: scene };
  // 돋보기 안의 자리 — 장면 범위 왼쪽 위에서 떨어진 만큼 zoom 배로. 두 단추가 2px 붙어 있어 마주 보는 쪽은 줄여 테두리를 띄운다
  const inLens = (rect: SpanRect, left: number, right: number): Box => ({
    x: lens.x + (rect.x - left - scene.x) * zoom,
    y: lens.y + (rect.y - 4 - scene.y) * zoom,
    w: (rect.width + left + right) * zoom,
    h: (rect.height + 8) * zoom,
  });
  const pills = [inLens(reopen, 4, -2), inLens(share, -2, 4)];
  const [reopenX, shareX] = pills.map((pill) => pill.x + pill.w / 2);
  const badges = [
    { no: 3, x: reopenX, y: lens.y },
    { no: 4, x: shareX, y: lens.y + lens.h },
  ];
  const labelW = 420;
  const leftX = 470;
  const rightX = 2040;
  const labelGap = 52;
  return {
    boxes: [ask, card],
    lens,
    marker,
    ties: [
      [lens.x + lens.w - lens.h / 2, lens.y, marker.x + marker.h / 2, marker.y],
      [lens.x + lens.w - lens.h / 2, lens.y + lens.h, marker.x + marker.h / 2, marker.y + marker.h],
    ],
    pills,
    badges,
    callouts: [
      {
        no: 1,
        title: '생각나는 대로 물어도 찾아 줘요',
        text: '제목을 몰라도, 그때 하던 일을 적으면 그 세션을 찾아 답해요.',
        at: { x: leftX, y: ask.y + ask.h / 2 - 84, w: labelW },
        from: [leftX + labelW + 6, ask.y + ask.h / 2],
        to: [ask.x - 6, ask.y + ask.h / 2],
      },
      {
        no: 2,
        title: '같은 일로 본 페이지는 한데 묶여 있어요',
        text: 'AI가 알아서 묶고 제목과 요약까지 붙여 둬요.',
        at: { x: leftX, y: card.y - 14, w: labelW },
        from: [leftX + labelW + 6, card.y + card.h / 2],
        to: [card.x - 6, card.y + card.h / 2],
      },
      {
        // 라벨은 돋보기 위 — 화살표는 위 테두리의 ③ 번호까지
        no: 3,
        title: '누르면 그때 페이지가 다시 열려요',
        text: '새 창으로도, 지금 창에도 한 번에 열어요.',
        at: { x: rightX, y: lens.y - labelGap - 150, w: labelW },
        from: [reopenX, lens.y - labelGap + 8],
        to: [reopenX, lens.y - 34],
      },
      {
        // 라벨은 돋보기 아래 — 화살표는 아래 테두리의 ④ 번호까지
        no: 4,
        title: '팀에는 내가 고른 세션만 올라가요',
        text: '팀원은 올라온 세션 안에서만 찾고 물어봐요.',
        at: { x: rightX, y: lens.y + lens.h + labelGap, w: labelW },
        from: [shareX, lens.y + lens.h + labelGap - 8],
        to: [shareX, lens.y + lens.h + 34],
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
  const label = ['현수막 — 실제 화면 시안 왼쪽', '현수막 — 실제 화면 시안 가운데', '현수막 — 실제 화면 시안 오른쪽'][part];

  return (
    // 세 장 모두 ORBIT 장(STEPS 의 2) — 번호는 시안의 장 목록(SPAN_CHAPTERS)에서 02 가 된다
    <BannerFrame step={2} label={label}>
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
          어제 봤던 그 페이지,
          <br />
          어디 갔지?
        </h1>
      )}
      {part === 1 && (
        <section className="ex-span__brand">
          <h1 className="ex-span__word">
            Orbit<span>.</span>
          </h1>
          <p className="ex-span__promise">봤던 페이지, 대신 기억해 둘게요.</p>
        </section>
      )}
      {part === 2 && (
        <section className="ex-span__real">
          <h1>
            지금 보이는 게
            <br />
            실제 Orbit 화면이에요.
          </h1>
          {/* 행동 유도 — 두 앞 띠·USE 와 같은 말. 가운데 벽이 화면이 되므로 시연 기기는 이름(노트북)으로 부른다 */}
          <p className="ex-cta">
            <i className="ph ph-arrow-right" />
            지금 써 보세요 · 시연은 가운데 노트북에서
          </p>
        </section>
      )}

      <section className="ex-span__proof" style={{ top: PROOF_TOP }} aria-label="시험으로 확인한 숫자">
        <ProvenStat stat={PROVEN_STATS[part]} />
        <p className="ex-fineprint">
          {part === 2
            ? PROVEN_NOTE
            : '화면: 실제 Orbit 새 탭(왼쪽 네비게이터를 연 홈, AI에게 질문)과 사이드패널(세션) · 세션과 방문은 시연용 합성 데이터 · 글꼴만 현수막 글꼴로 맞춤'}
        </p>
      </section>
    </BannerFrame>
  );
}

/** 벽 좌표의 강조 표시 층 — 장마다 같은 층을 자기 자리만큼 옮겨 그린다(나머지는 현수막 밖이라 잘린다). */
function Marks({ layout, x0, part }: { layout: Layout; x0: number; part: number }) {
  const { boxes, lens, marker, ties, pills, badges, callouts } = layout;
  const arrow = `ex-span-arrow-${part}`;
  const zoom = SPAN.scale * LENS.zoom;
  const inPanel = (left: number, right: number) => right > x0 && left < x0 + 950;
  return (
    <>
      <svg className="ex-span__marks" viewBox={`0 0 2930 ${BOOTH.height}`} style={{ left: -x0 }} aria-hidden>
        <defs>
          <marker id={arrow} viewBox="0 0 12 12" refX="10" refY="6" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L12,6 L0,12 z" className="ex-span__arrowhead" />
          </marker>
        </defs>
        {boxes.map((box, index) => (
          <rect key={index} x={box.x} y={box.y} width={box.w} height={box.h} rx="14" className="ex-span__box" />
        ))}
        {/* 돋보기와 사이드패널의 실제 단추 줄을 잇는 두 줄, 단추 줄을 두른 알약 */}
        {ties.map(([x1, y1, x2, y2], index) => (
          <line key={index} x1={x1} y1={y1} x2={x2} y2={y2} className="ex-span__tie" />
        ))}
        <rect x={marker.x} y={marker.y} width={marker.w} height={marker.h} rx={marker.h / 2} className="ex-span__ring" />
        {callouts.map((callout) => (
          <line key={callout.no} x1={callout.from[0]} y1={callout.from[1]} x2={callout.to[0]} y2={callout.to[1]} className="ex-span__leader" markerEnd={`url(#${arrow})`} />
        ))}
      </svg>

      {/* 돋보기 — 같은 장면을 한 번 더 띄워 단추 줄만 zoom 배로 보인다. 5번 장에만 걸리므로 그 장에서만 띄운다 */}
      {inPanel(lens.x, lens.x + lens.w) && (
        <div className="ex-span__lens" style={{ left: lens.x - x0, top: lens.y, width: lens.w, height: lens.h, borderRadius: lens.h / 2 }}>
          <Scene style={{ transform: `translate(${-lens.source.x * zoom}px, ${-lens.source.y * zoom}px) scale(${zoom})` }} />
          <svg viewBox={`${lens.x} ${lens.y} ${lens.w} ${lens.h}`} aria-hidden>
            {pills.map((pill, index) => (
              <rect key={index} x={pill.x} y={pill.y} width={pill.w} height={pill.h} rx={pill.h / 2} className="ex-span__pill" />
            ))}
          </svg>
        </div>
      )}
      {badges.map((badge) =>
        inPanel(badge.x - 28, badge.x + 28) ? (
          <b key={badge.no} className="ex-span__no ex-span__no--on" style={{ left: badge.x - 28 - x0, top: badge.y - 28 }}>
            {badge.no}
          </b>
        ) : null,
      )}

      {callouts.map((callout) =>
        inPanel(callout.at.x, callout.at.x + callout.at.w) ? (
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
