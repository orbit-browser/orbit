import type { OpenTabItem } from './types';

/** 미리보기 카드 하나. */
export interface TabPreviewItem {
  id: string;
  title: string;
  url: string;
  favIconUrl?: string;
  /** 캡처된 썸네일 JPEG data URL. 없으면 표지 카드로 그린다. */
  image?: string;
  active: boolean;
  windowId: number;
}

/** 열린 탭에 캐시된 썸네일을 붙인다. 없는 탭은 `image` 없이 나가 표지 카드가 된다. */
export function buildPreviewItems(
  tabs: OpenTabItem[],
  thumbnails: Record<string, { url: string; image: string }>,
): TabPreviewItem[] {
  return tabs.map((tab) => {
    const cached = thumbnails[tab.id];
    return {
      id: tab.id,
      title: tab.title,
      url: tab.url,
      favIconUrl: tab.favIconUrl,
      // 주소가 달라졌으면 예전 화면이므로 쓰지 않는다.
      image: cached && cached.url === tab.url ? cached.image : undefined,
      active: tab.active,
      windowId: tab.windowId,
    };
  });
}
