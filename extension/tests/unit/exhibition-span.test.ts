import { describe, expect, it } from 'vitest';
import { layoutFor, PROOF_TOP } from '../../preview/exhibition/panel-span';

// 실제 화면 시안 — 장면(span-scene.ts, 높이 740px, 현수막 글꼴)이 2026-10-23 미리보기에서 잰 요소 자리(장면 px)
const MEASURED = {
  question: { x: 1761.4, y: 332.8, width: 172.6, height: 44.4 },
  answer: { x: 1014, y: 389.1, width: 920, height: 130 },
  source: { x: 1014, y: 562.1, width: 300, height: 97.5 },
  reopen: { x: 2612, y: 513, width: 158.6, height: 24.5 },
  share: { x: 2772.6, y: 513, width: 55.3, height: 24.5 },
};

// 가운데 벽: 장 폭 950mm, 기둥 40mm, 옆 안전 여백 50mm. 현수막은 바닥에 세운다(높이 2,380mm)
const safeSpanOf = (left: number, right: number) =>
  [0, 1, 2].find((part) => left >= part * 990 + 50 && right <= part * 990 + 900);
const fromFloor = (y: number) => (2380 - y) / 1000;

describe('exhibition span mockup layout', () => {
  it('keeps every label, the lens and the answer box inside one banner, clear of the posts', () => {
    const layout = layoutFor(MEASURED)!;
    expect(layout.callouts.map((callout) => safeSpanOf(callout.at.x, callout.at.x + callout.at.w))).toEqual([0, 0, 2, 2]);
    expect(safeSpanOf(layout.lens.x, layout.lens.x + layout.lens.w)).toBe(2);
    const [ask] = layout.boxes;
    expect(ask.x).toBeGreaterThan(990);
    expect(ask.x + ask.w).toBeLessThan(1940);
  });

  it('puts the question and answer at eye level and the numbers above the waist', () => {
    const [ask] = layoutFor(MEASURED)!.boxes;
    // 디자인팀장 검토: ① 상자 위끝은 바닥에서 1.4~1.6m
    expect(fromFloor(ask.y)).toBeGreaterThanOrEqual(1.4);
    expect(fromFloor(ask.y)).toBeLessThanOrEqual(1.6);
    // 숫자 띠(약 153mm, 2026-10-23 측정)의 아래끝이 바닥에서 1m 위
    expect(fromFloor(PROOF_TOP + 153)).toBeGreaterThanOrEqual(1);
  });

  it('magnifies only the button row and pins ③ and ④ to their own buttons', () => {
    const layout = layoutFor(MEASURED)!;
    // 돋보기가 담는 장면 높이가 단추 줄(24.5px)과 여백뿐 — 위아래 목록 줄(파비콘·글자)은 들어오지 않는다
    expect(layout.lens.source.height).toBeLessThanOrEqual(24.5 + 20);
    const [reopenPill, sharePill] = layout.pills;
    const [three, four] = layout.badges;
    expect(three.no).toBe(3);
    expect(three.x).toBeGreaterThan(reopenPill.x);
    expect(three.x).toBeLessThan(reopenPill.x + reopenPill.w);
    expect(four.no).toBe(4);
    expect(four.x).toBeGreaterThan(sharePill.x);
    expect(four.x).toBeLessThan(sharePill.x + sharePill.w);
    // 실제 단추 줄을 두른 표시는 단추 줄 높이에서 위아래 3px 만 — 이웃 줄 글자를 긋지 않는다
    expect(layout.marker.h).toBeLessThanOrEqual((24.5 + 6) * 0.96 + 0.01);
  });

  it('waits for the scene instead of guessing when a target is missing', () => {
    expect(layoutFor({ ...MEASURED, share: undefined })).toBeNull();
  });
});
