import type { MemberBrief, Workspace } from '../../../../lib/types';
import { UserMenu } from '../layout/UserMenu';
import { SidebarToggle } from '../layout/SidebarToggle';

/**
 * 아틀라스 상단 바. 네비게이터 오른쪽 영역에만 걸치며,
 * 구성(토글 · 프로필)은 메인 페이지 상단 바와 동일하다.
 * 팀이 있으면 개인/팀 범위 선택을, 팀을 보고 있으면 공유한 사람 필터를 함께 둔다.
 */
interface AtlasHeaderProps {
  navOpen: boolean;
  onToggleNav: () => void;
  workspaces: Workspace[];
  scopeId: string | null;
  onScopeChange: (workspaceId: string | null) => void;
  /** 팀 화면에서 세션을 공유한 사람들. */
  sharers: MemberBrief[];
  sharerFilter: string | null;
  onSharerFilterChange: (userId: string | null) => void;
}

export function AtlasHeader({
  navOpen,
  onToggleNav,
  workspaces,
  scopeId,
  onScopeChange,
  sharers,
  sharerFilter,
  onSharerFilterChange,
}: AtlasHeaderProps) {
  return (
    <header className="atlas-header">
      <SidebarToggle open={navOpen} onToggle={onToggleNav} />
      {workspaces.length > 0 && (
        <div className="atlas-header__scope">
          {scopeId && sharers.length > 1 && (
            <select
              className="atlas-header__select"
              aria-label="공유한 사람"
              value={sharerFilter ?? ''}
              onChange={(event) => onSharerFilterChange(event.target.value || null)}
            >
              <option value="">모든 팀원</option>
              {sharers.map((sharer) => (
                <option key={sharer.userId} value={sharer.userId}>
                  {sharer.name ?? '팀원'}
                </option>
              ))}
            </select>
          )}
          <select
            className="atlas-header__select"
            aria-label="보고 있는 기록"
            value={scopeId ?? ''}
            onChange={(event) => onScopeChange(event.target.value || null)}
          >
            <option value="">개인 기록</option>
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <UserMenu />
    </header>
  );
}
