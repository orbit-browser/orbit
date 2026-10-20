import type { MemberBrief } from '../../../../lib/types';
import { UserMenu } from '../layout/UserMenu';
import { SidebarToggle } from '../layout/SidebarToggle';

/**
 * 아틀라스 상단 바. 네비게이터 오른쪽 영역에만 걸치며,
 * 구성(토글 · 프로필)은 메인 페이지 상단 바와 동일하다.
 * 워크스페이스(내 Orbit / 팀 Orbit) 전환은 프로필 메뉴에 있다. 팀을 보고 있으면
 * 공유한 사람 필터만 여기에 둔다.
 */
interface AtlasHeaderProps {
  navOpen: boolean;
  onToggleNav: () => void;
  /** 팀을 보고 있는지. 개인 기록이면 필터가 없다. */
  inTeam: boolean;
  /** 팀 화면에서 세션을 공유한 사람들. */
  sharers: MemberBrief[];
  sharerFilter: string | null;
  onSharerFilterChange: (userId: string | null) => void;
}

export function AtlasHeader({
  navOpen,
  onToggleNav,
  inTeam,
  sharers,
  sharerFilter,
  onSharerFilterChange,
}: AtlasHeaderProps) {
  return (
    <header className="atlas-header">
      <SidebarToggle open={navOpen} onToggle={onToggleNav} />
      {inTeam && sharers.length > 1 && (
        <div className="atlas-header__scope">
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
        </div>
      )}
      <UserMenu />
    </header>
  );
}
