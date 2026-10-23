import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Chapters, STEPS } from '../../preview/exhibition/frame';
import { SPAN_CHAPTERS, SpanBanner } from '../../preview/exhibition/panel-span';
import { TeamBanner } from '../../preview/exhibition/panel-team';

const text = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

// 실제 화면 시안은 가운데 벽 세 장이 한 장(ORBIT)이다 — 머리 표지가 CHAOS·TECHNOLOGY 로 남으면 내용과 어긋난다(마케팅팀장 검토 2026-10-23).
describe('exhibition chapter labels', () => {
  it('labels all three span banners as the ORBIT chapter, numbered within USE · ORBIT · TEAM', () => {
    for (const part of [0, 1, 2] as const) {
      const banner = text(createElement(Chapters.Provider, { value: SPAN_CHAPTERS }, createElement(SpanBanner, { part })));
      expect(banner, `part ${part}`).toContain('02 ORBIT');
      expect(banner, `part ${part}`).not.toMatch(/CHAOS|TECHNOLOGY/);
    }
    const team = text(createElement(Chapters.Provider, { value: SPAN_CHAPTERS }, createElement(TeamBanner)));
    expect(team).toContain('03 TEAM');
  });

  it('keeps the five-chapter numbering on the current print banners', () => {
    expect(text(createElement(TeamBanner))).toContain('05 TEAM');
    expect(STEPS).toEqual(['USE', 'CHAOS', 'ORBIT', 'TECHNOLOGY', 'TEAM']);
  });
});
