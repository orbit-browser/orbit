import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChaosBanner } from '../../preview/exhibition/panel-chaos';
import { EdgeBanner } from '../../preview/exhibition/panel-edge';
import { OrbitBanner } from '../../preview/exhibition/panel-orbit';
import { TeamBanner } from '../../preview/exhibition/panel-team';
import { TechBanner } from '../../preview/exhibition/panel-tech';
import { UseBanner } from '../../preview/exhibition/panel-use';

const text = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element).replace(/<[^>]*>/g, ' ');

const ALL_BANNERS = [
  createElement(EdgeBanner, { side: 'left' }),
  createElement(UseBanner),
  createElement(ChaosBanner),
  createElement(OrbitBanner, { sessionIndex: 0, pageIndex: 2, onSession: () => {}, onPage: () => {}, interactive: false, scaleRef: { current: 1 } }),
  createElement(TechBanner),
  createElement(TeamBanner),
  createElement(EdgeBanner, { side: 'right' }),
].map(text).join('\n');

// 대표가 "AI가 쓴 티"로 짚은 줄(2026-10-23)과 마케팅팀장 목록의 예 — 같은 말이 다시 들어오지 않게 한다.
describe('exhibition copy', () => {
  it('drops the lines the CEO flagged as machine-written', () => {
    for (const line of ['기준값은 재서 정한다', '다시 열면, 그', '말로 찾고, 다시 연다']) expect(ALL_BANNERS).not.toContain(line);
  });

  it('drops the abstract slogans from the marketing lead list', () => {
    for (const phrase of ['탐색의 흔적', '구조화된 기억', '당신의 탐색', '이어가다.']) expect(ALL_BANNERS).not.toContain(phrase);
  });
});
