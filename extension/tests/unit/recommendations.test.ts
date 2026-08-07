import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRecommendations } from '../../lib/api';
import { signInTestUser, signOutTestUser } from '../helpers';

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(async () => {
  await signInTestUser();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await signOutTestUser();
});

describe('추천 세션 API', () => {
  it('snake_case 응답을 camelCase로 매핑한다', async () => {
    stubFetch({
      items: [
        {
          session_id: 's1',
          title: '아라시야마 료칸 조사',
          kind: 'continue',
          reason: '2일 전 숙소 비교 도중 중단됨',
          score: 0.72,
        },
      ],
      computed_at: '2026-08-07T12:00:00+00:00',
      is_stale: false,
    });

    const result = await fetchRecommendations();

    expect(result.items).toEqual([
      {
        sessionId: 's1',
        title: '아라시야마 료칸 조사',
        kind: 'continue',
        reason: '2일 전 숙소 비교 도중 중단됨',
        score: 0.72,
      },
    ]);
    expect(result.computedAt).toBe('2026-08-07T12:00:00+00:00');
    expect(result.isStale).toBe(false);
  });

  it('컨텍스트 없이 부르면 쿼리 문자열을 붙이지 않는다', async () => {
    const fetchMock = stubFetch({ items: [], computed_at: null, is_stale: false });

    await fetchRecommendations();

    expect(fetchMock.mock.calls[0][0]).toMatch(/\/recommendations$/);
  });

  it('현재 탭과 검색어를 쿼리로 전달한다', async () => {
    const fetchMock = stubFetch({ items: [], computed_at: null, is_stale: false });

    await fetchRecommendations({
      currentTitle: '아반떼 vs K3',
      currentUrl: 'https://example.com/a',
      query: '유지비',
    });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('current_title=');
    expect(url).toContain('current_url=');
    expect(url).toContain('q=');
  });

  it('빈 추천도 정상 응답으로 다룬다', async () => {
    stubFetch({ items: [], computed_at: null, is_stale: false });

    const result = await fetchRecommendations();

    expect(result.items).toEqual([]);
    expect(result.computedAt).toBeNull();
  });

  it('stale 플래그를 그대로 전달한다', async () => {
    stubFetch({ items: [], computed_at: '2026-08-07T00:00:00+00:00', is_stale: true });

    expect((await fetchRecommendations()).isStale).toBe(true);
  });

  it('인증 헤더를 함께 보낸다', async () => {
    const fetchMock = stubFetch({ items: [], computed_at: null, is_stale: false });

    await fetchRecommendations();

    const init = fetchMock.mock.calls[0][1];
    expect(init.headers.Authorization).toBe('Bearer test-token');
  });
});
