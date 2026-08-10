import { afterEach, describe, expect, it, vi } from 'vitest';
import { activateOpenTab, getAllOpenTabs } from '../../lib/chrome-bridge';
import {
  filterOpenTabs,
  findBestOpenTab,
  mayBeOpenTabNavigation,
  parseOpenTabNavigationIntent,
} from '../../lib/tab-actions';
import type { OpenTabItem } from '../../lib/types';

function openTab(overrides: Partial<OpenTabItem> = {}): OpenTabItem {
  return {
    id: '11',
    windowId: 1,
    index: 0,
    active: false,
    title: 'Orbit documentation',
    url: 'https://example.com/orbit',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('open tab filtering', () => {
  const tabs = [
    openTab(),
    openTab({ id: '12', title: '뉴스', url: 'https://news.example.kr/article' }),
  ];

  it('제목과 URL을 대소문자 구분 없이 검색한다', () => {
    expect(filterOpenTabs(tabs, 'ORBIT').map((tab) => tab.id)).toEqual(['11']);
    expect(filterOpenTabs(tabs, 'NEWS.EXAMPLE').map((tab) => tab.id)).toEqual(['12']);
    expect(filterOpenTabs(tabs, '  ')).toEqual(tabs);
  });

  it('명시적인 탭 이동 문장에서 검색 대상을 추출한다', () => {
    expect(parseOpenTabNavigationIntent('지금 떠 있는 탭 중에 유튜브 찾아서 이동해줘')).toEqual({
      kind: 'navigate-open-tab',
      target: '유튜브',
    });
    expect(parseOpenTabNavigationIntent('“GitHub” 탭으로 전환해 주세요!')).toEqual({
      kind: 'navigate-open-tab',
      target: 'GitHub',
    });
    expect(parseOpenTabNavigationIntent('지금 열려있는 유튜브 탭으로 이동해줘')).toEqual({
      kind: 'navigate-open-tab',
      target: '유튜브',
    });
    expect(parseOpenTabNavigationIntent('이 탭 찾아서 이동해줘')).toEqual({
      kind: 'navigate-open-tab',
      target: '',
    });
    expect(parseOpenTabNavigationIntent('열린 탭을 기반으로 오늘 본 내용을 요약해줘')).toBeNull();
    expect(parseOpenTabNavigationIntent('열린 탭 목록을 보여줘')).toBeNull();
  });

  it('정확한 제목과 호스트를 부분 URL보다 우선한다', () => {
    const result = findBestOpenTab([
      openTab({ id: 'url', title: '검색 결과', url: 'https://example.com/path/github' }),
      openTab({ id: 'host', title: '코드', url: 'https://github.com/orbit' }),
      openTab({ id: 'title', title: 'GitHub', url: 'https://other.example' }),
    ], 'github');

    expect(result?.tab.id).toBe('title');
    expect(result?.matchCount).toBe(3);
  });

  it('한글 서비스 이름을 영문 제목과 도메인 별칭으로 찾는다', () => {
    const result = findBestOpenTab([
      openTab({ id: 'youtube', title: 'YouTube', url: 'https://www.youtube.com/' }),
      openTab({ id: 'other', title: '동영상', url: 'https://video.example.com/' }),
    ], '유튜브');

    expect(result?.tab.id).toBe('youtube');
    expect(result?.matchCount).toBe(1);
  });

  it('탭이라는 단어 없이도 자연스러운 이동 가능성을 판별한다', () => {
    expect(mayBeOpenTabNavigation('아까 보던 영상으로 돌아가자')).toBe(true);
    expect(mayBeOpenTabNavigation('오빗 코드 보던 데로 가줘')).toBe(true);
    expect(mayBeOpenTabNavigation('제품 로드맵 정리하던 페이지 열어줘')).toBe(true);
    expect(mayBeOpenTabNavigation('리액트와 뷰의 차이를 설명해줘')).toBe(false);
    expect(mayBeOpenTabNavigation('유튜브에서 고양이 영상을 찾아줘')).toBe(false);
  });
});

describe('Chrome open tab actions', () => {
  it('모든 일반 창 탭을 창·인덱스 순으로 매핑한다', async () => {
    const query = vi.fn(async () => [
      { id: 22, windowId: 2, index: 1, active: true, title: 'B', url: 'chrome://settings' },
      { id: 11, windowId: 1, index: 3, active: false, title: 'A', url: 'https://a.com' },
      { id: 33, windowId: 3, index: 0, active: false, title: 'Secret', url: 'https://secret', incognito: true },
    ]);
    vi.stubGlobal('chrome', { tabs: { query } });

    const result = await getAllOpenTabs();

    expect(query).toHaveBeenCalledWith({ windowType: 'normal' });
    expect(result.map((tab) => tab.id)).toEqual(['11', '22']);
  });

  it('창을 먼저 포커스한 뒤 탭을 활성화한다', async () => {
    const calls: string[] = [];
    vi.stubGlobal('chrome', {
      windows: { update: vi.fn(async () => { calls.push('window'); }) },
      tabs: {
        query: vi.fn(),
        update: vi.fn(async () => { calls.push('tab'); }),
      },
    });

    await activateOpenTab(openTab({ id: '42', windowId: 7 }));

    expect(calls).toEqual(['window', 'tab']);
  });
});
