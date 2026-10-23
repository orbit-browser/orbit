import { useEffect, useState } from 'react';
import { PanelRightOpen, UserPlus } from 'lucide-react';
import type { Workspace } from '../../../../lib/types';
import { openSettings } from '../../lib/navigation';

/**
 * 빈 상태의 다음 행동 — 세션을 만들거나 공유하는 곳은 사이드패널이고, 팀을 채우는 길은 초대다.
 * 문구로만 안내하면 사용자가 그 자리를 직접 찾아가야 한다.
 */
export function EmptyStateActions({ team }: { team: Workspace | null }) {
  const [windowId, setWindowId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // sidePanel.open 은 사용자 제스처 안에서 불러야 해서 창 id 를 미리 받아 둔다.
    void chrome.windows.getCurrent().then((current) => setWindowId(current.id ?? null)).catch(() => undefined);
  }, []);

  const openPanel = () => {
    setError(null);
    if (windowId == null) {
      setError('사이드패널을 열지 못했어요. 툴바의 Orbit 아이콘을 눌러 주세요.');
      return;
    }
    chrome.sidePanel.open({ windowId }).catch(() => setError('사이드패널을 열지 못했어요. 툴바의 Orbit 아이콘을 눌러 주세요.'));
  };

  return (
    <>
      <div className="data-state__actions">
        {team?.role === 'owner' && (
          <button
            type="button"
            className="data-state__primary"
            onClick={() => openSettings({ page: 'workspace', workspaceId: team.id })}
          >
            <UserPlus size={14} aria-hidden="true" /> 팀원 초대하기
          </button>
        )}
        <button type="button" className={team?.role === 'owner' ? undefined : 'data-state__primary'} onClick={openPanel}>
          <PanelRightOpen size={14} aria-hidden="true" /> {team ? '사이드패널에서 세션 공유하기' : '사이드패널 열기'}
        </button>
      </div>
      {error && (
        <p className="data-state__error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
