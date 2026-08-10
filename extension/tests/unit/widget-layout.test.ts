import { describe, expect, it } from 'vitest';
import {
  ALL_WIDGET_IDS,
  DEFAULT_LAYOUT,
  moveWidget,
  normalizeLayout,
  type WidgetId,
} from '../../lib/widget-layout';

describe('위젯 배치 정규화', () => {
  it('저장된 값이 없으면 기본 배치를 쓴다', () => {
    expect(normalizeLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(normalizeLayout(undefined)).toEqual(DEFAULT_LAYOUT);
  });

  it('사용자 순서를 지키고 새로 생긴 위젯은 뒤에 붙인다', () => {
    // 예전 버전에서 저장된, 일부 위젯만 아는 배치.
    const layout = normalizeLayout({ order: ['settings', 'collection'], hidden: [] });

    expect(layout.order.slice(0, 2)).toEqual(['settings', 'collection']);
    expect(layout.order).toHaveLength(ALL_WIDGET_IDS.length);
    expect(new Set(layout.order).size).toBe(ALL_WIDGET_IDS.length);
  });

  it('모르는 id 와 중복은 버린다', () => {
    const layout = normalizeLayout({
      order: ['collection', 'collection', 'ghost-widget', 'settings'],
      hidden: ['ghost-widget', 'topDomains'],
    });

    expect(layout.order.filter((id) => id === 'collection')).toHaveLength(1);
    expect(layout.order).not.toContain('ghost-widget' as WidgetId);
    expect(layout.hidden).toEqual(['topDomains']);
  });

  it('사용자가 모든 위젯을 켠 상태를 기본값으로 되돌리지 않는다', () => {
    // hidden: [] 은 "아무것도 숨기지 않음"이지 "저장 안 됨"이 아니다.
    expect(normalizeLayout({ order: [...ALL_WIDGET_IDS], hidden: [] }).hidden).toEqual([]);
  });
});

describe('위젯 순서 바꾸기', () => {
  const order: WidgetId[] = ['collection', 'workspace', 'openTabs', 'sessions'];

  it('앞에서 뒤로 옮긴다', () => {
    expect(moveWidget(order, 'collection', 'openTabs')).toEqual([
      'workspace',
      'openTabs',
      'collection',
      'sessions',
    ]);
  });

  it('뒤에서 앞으로 옮긴다', () => {
    expect(moveWidget(order, 'sessions', 'collection')).toEqual([
      'sessions',
      'collection',
      'workspace',
      'openTabs',
    ]);
  });

  it('원본을 바꾸지 않는다', () => {
    moveWidget(order, 'sessions', 'collection');
    expect(order).toEqual(['collection', 'workspace', 'openTabs', 'sessions']);
  });

  it('같은 자리거나 목록에 없으면 그대로 둔다', () => {
    expect(moveWidget(order, 'collection', 'collection')).toBe(order);
    expect(moveWidget(order, 'collection', 'merge')).toBe(order);
  });
});
