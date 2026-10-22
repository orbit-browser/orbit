import { describe, expect, it } from 'vitest';
import { EXCLUDED_SHOTS, GALLERY_SESSION_IDS, pageByUrl, printable, SESSIONS, SHOT_FOCUS, shownSession } from '../../preview/exhibition/content';
import { CLOUD, EXIT } from '../../preview/exhibition/panel-chaos';

// 현수막 카드에 들어가는 남의 사이트 화면 — 광고·팝업이 찍힌 화면이 인쇄 자리에 들어가지 않는지 지킨다.
describe('exhibition page shots', () => {
  it('scatters only printable pages that exist in the synthetic data, once each', () => {
    const urls = [...CLOUD, ...EXIT];
    expect(urls).toHaveLength(25);
    expect(new Set(urls).size).toBe(25);
    for (const url of urls) {
      expect(pageByUrl(url), url).toBeDefined();
      expect(EXCLUDED_SHOTS.has(url), url).toBe(false);
    }
  });

  it('keeps the screens the quality review flagged out of print', () => {
    const flagged = [
      'https://carmore.kr/home/', // 할인 팝업·홍보 배너
      'https://prod.danawa.com/list/?cate=112753', // "광고" 상품 줄
      'https://www.compuzone.co.kr/search/search.htm?SearchProductKey=5070', // "광고" 상품 줄
      'https://brunch.co.kr/@techtalk/42', // 작가 글 표지
      'https://blog.naver.com/runner/2231', // 특가 광고 썸네일
      'https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html', // 후원 광고
      'https://fastapi.tiangolo.com/tutorial/dependencies/dependencies-with-yield/', // 후원 광고
    ];
    for (const url of flagged) expect(EXCLUDED_SHOTS.has(url), url).toBe(true);
  });

  it('starts the gallery with the printed Jeju session and gives every session three printable pages or more', () => {
    expect(GALLERY_SESSION_IDS).toEqual(['s-jeju', 's-mv3', 's-qdrant']);
    for (const id of GALLERY_SESSION_IDS) {
      expect(SESSIONS.some((session) => session.id === id), id).toBe(true);
      expect(shownSession(id).pages.length, id).toBeGreaterThanOrEqual(3);
    }
    // 렌터카(카모아)는 화면을 빼서 갤러리에 없고, 타임라인에는 남는다
    expect(shownSession('s-jeju').pages.map((page) => page.domain)).toEqual([
      'flight.naver.com',
      'yanolja.com',
      'blog.naver.com',
      'weather.go.kr',
      'diningcode.com',
    ]);
    expect(SESSIONS.find((session) => session.id === 's-jeju')!.pages).toHaveLength(6);
  });

  it('sends the same Jeju pages out of CHAOS that ORBIT shows', () => {
    expect([...EXIT].reverse()).toEqual(shownSession('s-jeju').pages.map((page) => page.url));
  });

  it('keeps focus boxes inside the 1000 x 1600 capture for the tallest card', () => {
    // CHAOS 세로 카드는 폭의 1.17배 높이까지 화면을 보인다(1.3 비율 카드에서 탭·주소 줄을 뺀 높이)
    const tallest = 1.17;
    for (const [url, { x, y, w }] of Object.entries(SHOT_FOCUS)) {
      const page = pageByUrl(url);
      expect(page && printable(page), url).toBe(true);
      expect(x >= 0 && y >= 0 && w > 0 && x + w <= 1000, url).toBe(true);
      expect(y + w * tallest <= 1600, url).toBe(true);
    }
  });
});
