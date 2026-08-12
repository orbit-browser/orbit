import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import {
  MAX_SEARCH_HISTORY,
  appendSearchQuery,
  filterSearchHistory,
  loadSearchHistory,
  recordSearchQuery,
  removeSearchQuery,
  type SearchHistoryEntry,
} from '../../entrypoints/newtab/lib/search-history';

const make = (query: string, at = 0): SearchHistoryEntry => ({ query, at });

beforeEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

describe('appendSearchQuery', () => {
  it('최근 검색어를 맨 앞에 둔다', () => {
    const list = appendSearchQuery(appendSearchQuery([], 'gpt', 1), 'kimi api', 2);
    expect(list.map((e) => e.query)).toEqual(['kimi api', 'gpt']);
  });

  it('같은 검색어는 쌓지 않고 위로 올리며 시각을 갱신한다', () => {
    const list = appendSearchQuery([make('gpt', 1), make('세피리아', 2)], '  GPT ', 5);
    expect(list).toEqual([{ query: 'GPT', at: 5 }, { query: '세피리아', at: 2 }]);
  });

  it('빈 입력이나 공백만 있는 입력은 기록하지 않는다', () => {
    expect(appendSearchQuery([], '', 1)).toEqual([]);
    expect(appendSearchQuery([make('gpt')], '   ', 1)).toEqual([make('gpt')]);
  });

  it('상한을 넘으면 가장 오래된 항목이 밀려난다', () => {
    let list: SearchHistoryEntry[] = [];
    for (let i = 0; i <= MAX_SEARCH_HISTORY; i += 1) {
      list = appendSearchQuery(list, `q${i}`, i);
    }
    expect(list).toHaveLength(MAX_SEARCH_HISTORY);
    expect(list[0].query).toBe(`q${MAX_SEARCH_HISTORY}`);
    expect(list.some((e) => e.query === 'q0')).toBe(false);
  });
});

describe('removeSearchQuery', () => {
  it('대소문자와 공백 차이를 무시하고 지운다', () => {
    expect(removeSearchQuery([make('GPT'), make('kimi')], ' gpt ')).toEqual([make('kimi')]);
  });
});

describe('filterSearchHistory', () => {
  const list = [make('kimi api'), make('chatgpt api'), make('세피리아')];

  it('입력이 비면 전체를 그대로 돌려준다', () => {
    expect(filterSearchHistory(list, '  ')).toEqual(list);
  });

  it('대소문자를 구분하지 않고 부분 일치로 좁힌다', () => {
    expect(filterSearchHistory(list, 'API').map((e) => e.query)).toEqual([
      'kimi api',
      'chatgpt api',
    ]);
  });

  it('지금 입력한 것과 같은 검색어는 뺀다', () => {
    expect(filterSearchHistory(list, 'kimi api').map((e) => e.query)).toEqual([]);
  });
});

describe('저장소', () => {
  it('저장한 기록을 다시 읽는다', async () => {
    await recordSearchQuery('gpt', 1);
    await recordSearchQuery('kimi api', 2);
    expect((await loadSearchHistory()).map((e) => e.query)).toEqual(['kimi api', 'gpt']);
  });

  it('손상된 값이 저장돼 있으면 버리고 빈 목록으로 시작한다', async () => {
    await chrome.storage.local.set({ 'newtab.searchHistory': { broken: true } });
    expect(await loadSearchHistory()).toEqual([]);
  });

  it('형식이 어긋난 항목만 걸러낸다', async () => {
    await chrome.storage.local.set({
      'newtab.searchHistory': [{ query: 'gpt', at: 1 }, { query: '  ' }, null, { at: 2 }],
    });
    expect(await loadSearchHistory()).toEqual([{ query: 'gpt', at: 1 }]);
  });

  it('읽기에 실패해도 빈 목록을 돌려준다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(chrome.storage.local, 'get').mockRejectedValue(new Error('boom'));
    expect(await loadSearchHistory()).toEqual([]);
  });

  it('저장에 실패해도 예외를 던지지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(chrome.storage.local, 'set').mockRejectedValue(new Error('boom'));
    await expect(recordSearchQuery('gpt', 1)).resolves.toEqual([{ query: 'gpt', at: 1 }]);
  });
});
