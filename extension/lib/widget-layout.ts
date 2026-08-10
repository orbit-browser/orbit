/**
 * 사이드패널 위젯 배치.
 *
 * macOS 제어 센터처럼 사용자가 위젯을 끄고 켜고 순서를 바꾼다.
 * 진실 원천은 `chrome.storage.local` 이며, 저장 형식은 설정(`lib/settings.ts`)과 같은
 * 평문 JSON 이다.
 */

export type WidgetId =
  | 'collection'
  | 'workspace'
  | 'openTabs'
  | 'sessions'
  | 'timeline'
  | 'recommend'
  | 'topDomains'
  | 'todayActivity'
  | 'dashboard'
  | 'refresh'
  | 'settings'
  | 'merge';

export interface WidgetLayout {
  /** 화면에 놓이는 순서. 숨긴 위젯도 순서를 기억하도록 함께 담는다. */
  order: WidgetId[];
  hidden: WidgetId[];
}

/** 알려진 모든 위젯 — 순서는 기본 배치이기도 하다. */
export const ALL_WIDGET_IDS: readonly WidgetId[] = [
  'collection',
  'workspace',
  'openTabs',
  'sessions',
  'timeline',
  'recommend',
  'dashboard',
  'refresh',
  'settings',
  'merge',
  'todayActivity',
  'topDomains',
];

export const DEFAULT_LAYOUT: WidgetLayout = {
  order: [...ALL_WIDGET_IDS],
  // 기본 화면을 조용하게 두고, 편집에서 추가할 거리를 하나 남긴다.
  hidden: ['topDomains'],
};

const STORAGE_KEY = 'orbit:widgets';

/**
 * 저장된 배치를 현재 위젯 목록에 맞춘다.
 *
 * 버전이 올라가며 위젯이 추가·삭제돼도 기존 사용자의 배치를 버리지 않는다 —
 * 모르는 id 는 버리고, 새로 생긴 위젯은 뒤에 붙인다.
 */
export function normalizeLayout(raw: unknown): WidgetLayout {
  const known = new Set<WidgetId>(ALL_WIDGET_IDS);
  const source = (raw ?? {}) as Partial<WidgetLayout>;

  const seen = new Set<WidgetId>();
  const order: WidgetId[] = [];
  for (const id of Array.isArray(source.order) ? source.order : []) {
    if (known.has(id as WidgetId) && !seen.has(id as WidgetId)) {
      seen.add(id as WidgetId);
      order.push(id as WidgetId);
    }
  }
  // 새로 생긴 위젯은 기본 배치의 상대 순서를 지키며 뒤에 붙는다.
  for (const id of ALL_WIDGET_IDS) {
    if (!seen.has(id)) order.push(id);
  }

  const storedHidden = Array.isArray(source.hidden) ? source.hidden : null;
  const hidden = storedHidden
    ? [...new Set(storedHidden.filter((id): id is WidgetId => known.has(id as WidgetId)))]
    : [...DEFAULT_LAYOUT.hidden];

  return { order, hidden };
}

/** 드래그로 자리를 바꾼 결과. 원본을 바꾸지 않는다. */
export function moveWidget(order: WidgetId[], fromId: WidgetId, toId: WidgetId): WidgetId[] {
  if (fromId === toId) return order;
  const from = order.indexOf(fromId);
  const to = order.indexOf(toId);
  if (from < 0 || to < 0) return order;

  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, fromId);
  return next;
}

export async function getWidgetLayout(): Promise<WidgetLayout> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return normalizeLayout(null);
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    return normalizeLayout(stored[STORAGE_KEY]);
  } catch {
    // 저장소를 못 읽어도 기본 배치로 화면은 그린다.
    return normalizeLayout(null);
  }
}

export async function saveWidgetLayout(layout: WidgetLayout): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: layout });
  } catch {
    // 저장 실패는 다음 변경에서 다시 시도된다 — 화면 상태는 이미 반영돼 있다.
  }
}
