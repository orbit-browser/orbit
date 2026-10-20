import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dismissFolderSuggestion,
  fetchFolderSuggestions,
  fetchServerSettings,
  fetchSessions,
  updateServerSettings,
} from '../../lib/api';
import { fetchAtlasData } from '../../entrypoints/newtab/hooks/useAtlasData';
import { signInTestUser, signOutTestUser } from '../helpers';

beforeEach(async () => {
  // API 호출은 로그인 상태를 요구한다.
  await signInTestUser();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await signOutTestUser();
});

function backendSession(overrides: Record<string, unknown> = {}) {
  return {
    session_id: 's1',
    title: '세션',
    alias: null,
    summary: { overview: '', purpose: '', highlights: [], todos: [], next_actions: [] },
    summary_status: 'done',
    tabs: [],
    created_at: '2026-10-20T09:00:00.000Z',
    updated_at: '2026-10-20T09:00:00.000Z',
    last_activity_at: null,
    folder_id: null,
    folder_assigned_by: null,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body, text: async () => '' };
}

describe('folder auto-classify API contract', () => {
  it('folder_assigned_by 를 매핑하고 null 은 undefined 로 둔다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse([
          backendSession({ session_id: 'auto', folder_id: 'f1', folder_assigned_by: 'auto' }),
          backendSession({ session_id: 'legacy' }),
        ]),
      ),
    );

    const sessions = await fetchSessions();

    expect(sessions.map((s) => [s.id, s.folderId, s.folderAssignedBy])).toEqual([
      ['auto', 'f1', 'auto'],
      ['legacy', undefined, undefined],
    ]);
  });

  it('폴더 제안을 camelCase 로 매핑한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse([
          { session_id: 's1', folder_id: 'f1', score: 0.43, similar_session_ids: ['s7', 's9'] },
        ]),
      ),
    );

    await expect(fetchFolderSuggestions()).resolves.toEqual([
      { sessionId: 's1', folderId: 'f1', score: 0.43, similarSessionIds: ['s7', 's9'] },
    ]);
  });

  it('제안 닫기는 본문 없이 POST 한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    await dismissFolderSuggestion('s1');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/folders/suggestions/s1/dismiss',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('폴더 자동 정리 설정을 조회하고 변경한다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ auto_merge_enabled: true, auto_folder_enabled: false }))
      .mockResolvedValueOnce(jsonResponse({ auto_merge_enabled: true, auto_folder_enabled: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchServerSettings()).resolves.toEqual({
      autoMergeEnabled: true,
      autoFolderEnabled: false,
    });
    await expect(updateServerSettings({ autoFolderEnabled: true })).resolves.toEqual({
      autoMergeEnabled: true,
      autoFolderEnabled: true,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8000/settings',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ auto_folder_enabled: true }),
      }),
    );
  });

  it('Atlas 데이터는 제안을 기다리지 않는다 — 제안은 따로 불러오고 503 이면 실패한다', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/folders/suggestions')) return jsonResponse({ detail: 'down' }, 503);
      return jsonResponse([]);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAtlasData()).resolves.toEqual({ sessions: [], folders: [], unfiled: [] });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain(
      'http://localhost:8000/folders/suggestions',
    );
    await expect(fetchFolderSuggestions()).rejects.toThrow();
  });
});
