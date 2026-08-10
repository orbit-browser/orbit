import { useUIStore } from '../store/ui';
import { AskSheet } from './AskSheet';
import { MergeSheet } from './MergeSheet';
import { OpenTabsSheet } from './OpenTabsSheet';
import { SessionsSheet } from './SessionsSheet';
import { SettingsSheet } from './SettingsSheet';
import { TimelineSheet } from './TimelineSheet';

/**
 * 시트 스택의 최상단 한 장만 그린다.
 *
 * 아래 장까지 그리면 좁은 사이드패널에서 스크롤 위치가 여러 벌 살아남아
 * 뒤로 갔을 때 엉뚱한 곳에 떨어진다. 스택은 "돌아갈 경로"만 담는다.
 */
export function SheetHost() {
  const sheet = useUIStore((s) => s.sheets.at(-1));
  if (!sheet) return null;

  switch (sheet.kind) {
    case 'open-tabs':
      return <OpenTabsSheet />;
    case 'timeline':
      return <TimelineSheet />;
    case 'sessions':
      return <SessionsSheet />;
    case 'merge':
      return <MergeSheet />;
    case 'ask':
      return <AskSheet />;
    case 'settings':
      return <SettingsSheet />;
  }
}
