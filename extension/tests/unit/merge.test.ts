import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchMergeSuggestions,
  fetchServerSettings,
  mergeSessions,
  unmergeSessions,
  updateServerSettings,
} from '../../lib/api';
import { isMergePairAvailable, markMergePairConsumed } from '../../lib/merge';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('merge batch guard', () => {
  it('성공한 병합과 세션이 겹치는 다음 쌍을 거부한다', () => {
    const consumed = new Set<string>();
    const first = { survivorId: 'a', absorbedId: 'b' };
    const overlapping = { survivorId: 'a', absorbedId: 'c' };
    const independent = { survivorId: 'd', absorbedId: 'e' };

    expect(isMergePairAvailable(consumed, first)).toBe(true);
    markMergePairConsumed(consumed, first);
    expect(isMergePairAvailable(consumed, overlapping)).toBe(false);
    expect(isMergePairAvailable(consumed, independent)).toBe(true);
  });
});

describe('merge API contract', () => {
  it('병합 제안을 camelCase로 매핑한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          {
            survivor_id: 'a',
            absorbed_id: 'b',
            survivor_title: 'A',
            absorbed_title: 'B',
            score: 0.84,
            signals: { vector_score: 0.84, keyword_overlap: ['orbit'] },
          },
        ],
      }),
    );

    await expect(fetchMergeSuggestions()).resolves.toEqual([
      {
        survivorId: 'a',
        absorbedId: 'b',
        survivorTitle: 'A',
        absorbedTitle: 'B',
        score: 0.84,
        keywordOverlap: ['orbit'],
      },
    ]);
  });

  it('병합과 되돌리기 요청에 absorbed_id를 전송한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    await mergeSessions('a', 'b');
    await unmergeSessions('a', 'b');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8000/sessions/a/merge',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ absorbed_id: 'b' }) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8000/sessions/a/unmerge',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ absorbed_id: 'b' }) }),
    );
  });

  it('서버 자동병합 설정을 조회하고 변경한다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ auto_merge_enabled: false }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ auto_merge_enabled: true }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchServerSettings()).resolves.toEqual({ autoMergeEnabled: false });
    await expect(updateServerSettings({ autoMergeEnabled: true })).resolves.toEqual({
      autoMergeEnabled: true,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8000/settings',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ auto_merge_enabled: true }),
      }),
    );
  });
});
