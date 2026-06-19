import type { TabItem } from '../../../lib/types';
import { openTabs } from '../../../lib/chrome-bridge';
import { useUIStore } from '../store/ui';
import { Favicon } from './Favicon';
import { OverflowMenu } from './OverflowMenu';

export function TabListItem({ tab }: { tab: TabItem }) {
  const showToast = useUIStore((s) => s.showToast);

  return (
    <div className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-orbit-bg">
      <Favicon src={tab.favIconUrl} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{tab.title}</p>
        <p className="truncate text-xs text-orbit-muted">{tab.url}</p>
      </div>
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
    </div>
  );
}
