import { useQueryClient } from '@tanstack/react-query';
import {
  AppWindow,
  Clock,
  GitMerge,
  LayoutGrid,
  Library,
  RefreshCw,
  Settings,
} from 'lucide-react';
import { WidgetCircle, WidgetTile } from './WidgetFrame';
import { useMergeSuggestions } from '../../hooks/useMergeSuggestions';
import { useSessions } from '../../hooks/useSessions';
import { useOpenTabs } from '../../hooks/useTabs';
import { useSyncStatus } from '../../hooks/useSyncStatus';
import { useUIStore } from '../../store/ui';

/** 열린 탭 — 누르면 시트에서 탭 미리보기를 카드로 보여준다. */
export function OpenTabsWidget() {
  const { data: tabs = [] } = useOpenTabs();
  const openSheet = useUIStore((s) => s.openSheet);

  return (
    <WidgetTile
      icon={<AppWindow size={16} />}
      title="열린 탭"
      status={`${tabs.length}개`}
      active={tabs.length > 0}
      expandable
      ariaLabel="열린 탭 미리보기"
      onClick={() => openSheet({ kind: 'open-tabs' })}
    />
  );
}

export function SessionsWidget() {
  const { data: sessions, isLoading, isError } = useSessions();
  const openSheet = useUIStore((s) => s.openSheet);
  const count = sessions?.length ?? 0;

  return (
    <WidgetTile
      icon={<Library size={16} />}
      title="저장된 세션"
      status={isError ? '오류' : isLoading ? '불러오는 중' : `${count}개`}
      active={count > 0}
      expandable
      ariaLabel="저장된 세션 열기"
      onClick={() => openSheet({ kind: 'sessions' })}
    />
  );
}

export function TimelineWidget() {
  const { data: status } = useSyncStatus();
  const openSheet = useUIStore((s) => s.openSheet);
  const todayCount = status?.todayCount ?? 0;

  return (
    <WidgetTile
      icon={<Clock size={16} />}
      title="타임라인"
      status={todayCount > 0 ? `오늘 ${todayCount}개` : '기록 없음'}
      active={todayCount > 0}
      expandable
      ariaLabel="탐색 타임라인 열기"
      onClick={() => openSheet({ kind: 'timeline' })}
    />
  );
}

/** 대시보드(새 탭 아틀라스)를 연다. 이미 열려 있으면 그 탭으로 이동한다. */
export function DashboardWidget() {
  const showToast = useUIStore((s) => s.showToast);

  async function openDashboard() {
    const url = chrome.runtime.getURL('/newtab.html#/orbit-atlas');
    try {
      // 해시만 다른 새 탭 페이지도 같은 문서라 `newtab.html` 전체를 후보로 본다.
      const existing = await chrome.tabs.query({ url: chrome.runtime.getURL('/newtab.html') });
      const target = existing.find((tab) => tab.id !== undefined);
      if (target?.id !== undefined) {
        await chrome.tabs.update(target.id, { active: true, url });
        await chrome.windows.update(target.windowId, { focused: true });
        return;
      }
      await chrome.tabs.create({ url });
    } catch {
      showToast('대시보드를 열지 못했어요');
    }
  }

  return (
    <WidgetCircle
      icon={<LayoutGrid size={18} />}
      label="대시보드 열기"
      active={false}
      onClick={() => void openDashboard()}
    />
  );
}

export function RefreshWidget() {
  const showToast = useUIStore((s) => s.showToast);
  const queryClient = useQueryClient();

  return (
    <WidgetCircle
      icon={<RefreshCw size={17} />}
      label="새로고침"
      active={false}
      onClick={() => {
        queryClient.invalidateQueries();
        showToast('새로고침했어요');
      }}
    />
  );
}

export function SettingsWidget() {
  const openSheet = useUIStore((s) => s.openSheet);

  return (
    <WidgetCircle
      icon={<Settings size={17} />}
      label="설정"
      active={false}
      onClick={() => openSheet({ kind: 'settings' })}
    />
  );
}

/** 병합 제안. 제안이 없을 때 격자에서 빼는 판단은 `ControlDeck` 이 한다. */
export function MergeWidget() {
  const { data } = useMergeSuggestions();
  const openSheet = useUIStore((s) => s.openSheet);
  const count = data?.length ?? 0;

  return (
    <WidgetCircle
      icon={<GitMerge size={17} />}
      label={`병합 제안 ${count}쌍`}
      active={count > 0}
      badge={count}
      onClick={() => openSheet({ kind: 'merge' })}
    />
  );
}
