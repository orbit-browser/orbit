import { describe, expect, it } from 'vitest';
import { layoutFor } from '../../preview/exhibition/panel-span';

// 실제 화면 시안 — 장면(span-scene.ts)이 2026-10-23 미리보기에서 잰 요소 자리(장면 px)
const MEASURED = {
  question: { x: 1769.5, y: 628.8, width: 164.5, height: 44.4 },
  answer: { x: 1014, y: 685.1, width: 920, height: 130 },
  source: { x: 1014, y: 858.1, width: 300, height: 97.5 },
  reopen: { x: 2612, y: 493.5, width: 152.2, height: 24.5 },
  share: { x: 2766.2, y: 493.5, width: 53.1, height: 24.5 },
};

// 가운데 벽: 장 폭 950mm, 기둥 40mm, 옆 안전 여백 50mm
const safeSpanOf = (left: number, right: number) =>
  [0, 1, 2].find((part) => left >= part * 990 + 50 && right <= part * 990 + 900);

describe('exhibition span mockup layout', () => {
  it('keeps every label, the lens and the answer box inside one banner, clear of the posts', () => {
    const layout = layoutFor(MEASURED)!;
    expect(layout).not.toBeNull();
    expect(layout.callouts.map((callout) => safeSpanOf(callout.at.x, callout.at.x + callout.at.w))).toEqual([0, 0, 2, 2]);
    expect(safeSpanOf(layout.lens.x - layout.lens.r, layout.lens.x + layout.lens.r)).toBe(2);
    const [ask] = layout.boxes;
    expect(ask.x).toBeGreaterThan(990);
    expect(ask.x + ask.w).toBeLessThan(1940);
  });

  it('waits for the scene instead of guessing when a target is missing', () => {
    expect(layoutFor({ ...MEASURED, share: undefined })).toBeNull();
  });
});
