import { describe, expect, it } from 'vitest';
import { layoutFor, PROOF_TOP, WINDOW_BOTTOM } from '../../preview/exhibition/panel-span';

// 실제 화면 시안 — 장면(span-scene.ts, 높이 1,110px, 질문 두 번, 현수막 글꼴)이 2026-10-23 미리보기에서 잰 요소 자리(장면 px)
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
  it('keeps every label, both lenses and the answer box inside one banner, clear of the posts', () => {
    const layout = layoutFor(MEASURED)!;
    expect(layout.callouts.map((callout) => safeSpanOf(callout.at.x, callout.at.x + callout.at.w))).toEqual([0, 0, 2, 2]);
    expect(layout.lenses.map((lens) => safeSpanOf(lens.x, lens.x + lens.w))).toEqual([2, 2]);
    const [ask] = layout.boxes;
    expect(ask.x).toBeGreaterThan(990);
    expect(ask.x + ask.w).toBeLessThan(1940);
  });

  it('makes the window tall and fills the space below it, keeping the marks at eye level', () => {
    const layout = layoutFor(MEASURED)!;
    // 대표 피드백 2026-10-23: 창이 장 높이의 많은 부분을 차지하고(r2 는 710mm), 아래 1m 를 비워 두지 않는다
    expect(WINDOW_BOTTOM - 495).toBeGreaterThanOrEqual(1000);
    expect(fromFloor(WINDOW_BOTTOM)).toBeLessThanOrEqual(0.85);
    expect(PROOF_TOP).toBeGreaterThan(WINDOW_BOTTOM);
    expect(PROOF_TOP).toBeLessThan(WINDOW_BOTTOM + 100);
    // ① 상자 위끝은 바닥에서 1.4~1.6m(디자인팀장 검토), ③·④ 묶음은 눈높이(약 1.2~1.7m) 안
    const [ask] = layout.boxes;
    expect(fromFloor(ask.y)).toBeGreaterThanOrEqual(1.4);
    expect(fromFloor(ask.y)).toBeLessThanOrEqual(1.6);
    const four = layout.lenses[1];
    expect(fromFloor(layout.callouts[2].at.y)).toBeLessThanOrEqual(1.7);
    expect(fromFloor(four.y + four.h)).toBeGreaterThanOrEqual(1.2);
  });

  it('puts each button under its own short label, without arrows or badges', () => {
    const layout = layoutFor(MEASURED)!;
    const [, , label3, label4] = layout.callouts;
    const [three, four] = layout.lenses;
    // 대표 피드백 "빽빽하다": ③·④는 제목만, 화살표 없이 라벨 바로 아래 그 단추의 돋보기
    expect([label3.text, label3.arrow, label4.text, label4.arrow]).toEqual([undefined, undefined, undefined, undefined]);
    expect(three.y - label3.at.y).toBeGreaterThan(0);
    expect(three.y - label3.at.y).toBeLessThan(140);
    expect(four.y - label4.at.y).toBeGreaterThan(0);
    expect(four.y - label4.at.y).toBeLessThan(140);
    expect(label4.at.y).toBeGreaterThan(three.y + three.h);
    // ③은 열기 두 단추만, ④는 공유 단추만 — 2px 붙은 이웃 단추는 잘라 낸다
    expect(three.keep[1]).toBeLessThan(MEASURED.share.x);
    expect(four.keep[0]).toBeGreaterThan(MEASURED.reopen.x + MEASURED.reopen.width);
    // 위아래 목록 줄(파비콘·글자)은 들어오지 않는다
    for (const lens of layout.lenses) expect(lens.source.height).toBeLessThanOrEqual(24.5 + 20);
    // 실제 단추 줄을 두른 표시는 단추 줄 높이에서 위아래 3px 만 — 이웃 줄 글자를 긋지 않는다
    expect(layout.marker.h).toBeLessThanOrEqual((24.5 + 6) * 0.96 + 0.01);
  });

  it('waits for the scene instead of guessing when a target is missing', () => {
    expect(layoutFor({ ...MEASURED, share: undefined })).toBeNull();
  });
});
