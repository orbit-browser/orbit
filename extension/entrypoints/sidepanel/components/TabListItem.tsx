import type { TabItem } from '../../../lib/types';
import { openTabs } from '../../../lib/chrome-bridge';
import { useUIStore } from '../store/ui';
import { ControlRow } from './control/ControlRow';
import { Favicon } from './Favicon';
import { OverflowMenu } from './OverflowMenu';

/**
 * 세션 상세의 탭 한 줄.
 *
 * 주소는 보여주지 않는다 — 긴 URL 이 두 줄을 잡아먹어 목록을 훑기 어려웠다.
 * 전체 주소는 툴팁과 더보기 메뉴의 "링크 복사"로 닿을 수 있다.
 */
export function TabListItem({ tab }: { tab: TabItem }) {
  const showToast = useUIStore((s) => s.showToast);

  return (
    <ControlRow
      icon={<Favicon pageUrl={tab.url} src={tab.favIconUrl} size={18} />}
      title={tab.title || tab.url}
      active
      onClick={() => {
        void openTabs([tab.url]);
        showToast('탭을 열었어요');
      }}
      trailing={
        <OverflowMenu
          actions={[
            {
              label: '탭 열기',
              onClick: () => {
                void openTabs([tab.url]);
                showToast('탭을 열었어요');
              },
            },
            {
              label: '링크 복사',
              onClick: () => {
                void navigator.clipboard.writeText(tab.url);
                showToast('링크를 복사했어요');
              },
            },
          ]}
        />
      }
    />
  );
}
