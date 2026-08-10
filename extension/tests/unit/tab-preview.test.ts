import { describe, expect, it } from 'vitest';
import { buildPreviewItems } from '../../lib/tab-preview';
import { isCapturableUrl, needsCapture, pruneThumbnails } from '../../lib/tab-thumbnails';
import type { OpenTabItem } from '../../lib/types';

function openTab(overrides: Partial<OpenTabItem> = {}): OpenTabItem {
  return {
    id: '1',
    windowId: 1,
    index: 0,
    active: false,
    title: '문서',
    url: 'https://example.com/a',
    ...overrides,
  };
}

function thumb(url: string, capturedAt = 1) {
  return { url, image: `data:image/jpeg;base64,${url}`, capturedAt };
}

describe('미리보기 카드 조립', () => {
  it('캐시된 썸네일을 붙인다', () => {
    const items = buildPreviewItems([openTab()], { '1': thumb('https://example.com/a') });

    expect(items[0].image).toBe('data:image/jpeg;base64,https://example.com/a');
  });

  it('탭이 다른 주소로 옮겨갔으면 옛 썸네일을 쓰지 않는다', () => {
    // 그대로 쓰면 전혀 다른 페이지 화면을 보여주게 된다.
    const items = buildPreviewItems([openTab({ url: 'https://example.com/b' })], {
      '1': thumb('https://example.com/a'),
    });

    expect(items[0].image).toBeUndefined();
  });

  it('썸네일이 없어도 카드는 만든다', () => {
    const items = buildPreviewItems([openTab()], {});

    expect(items).toHaveLength(1);
    expect(items[0].image).toBeUndefined();
    expect(items[0].title).toBe('문서');
  });

  it('탭 순서를 그대로 유지한다', () => {
    const tabs = [openTab({ id: 'a' }), openTab({ id: 'b' }), openTab({ id: 'c' })];

    expect(buildPreviewItems(tabs, {}).map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('썸네일 캐시', () => {
  it('http(s) 페이지만 찍는다', () => {
    expect(isCapturableUrl('https://example.com')).toBe(true);
    expect(isCapturableUrl('http://localhost:5173')).toBe(true);
    expect(isCapturableUrl('chrome://settings')).toBe(false);
    expect(isCapturableUrl('chrome-extension://abc/newtab.html')).toBe(false);
    expect(isCapturableUrl('')).toBe(false);
  });

  it('같은 주소가 이미 있으면 다시 찍지 않는다', () => {
    const map = { '7': thumb('https://example.com/a') };

    expect(needsCapture(map, 7, 'https://example.com/a')).toBe(false);
    expect(needsCapture(map, 7, 'https://example.com/b')).toBe(true);
    expect(needsCapture(map, 8, 'https://example.com/a')).toBe(true);
  });

  it('오래된 것부터 버려 개수를 유지한다', () => {
    const map = {
      old: thumb('https://a', 100),
      mid: thumb('https://b', 200),
      fresh: thumb('https://c', 300),
    };

    expect(Object.keys(pruneThumbnails(map, 2)).sort()).toEqual(['fresh', 'mid']);
  });

  it('한도 안이면 그대로 둔다', () => {
    const map = { a: thumb('https://a', 1) };
    expect(pruneThumbnails(map, 5)).toBe(map);
  });
});
