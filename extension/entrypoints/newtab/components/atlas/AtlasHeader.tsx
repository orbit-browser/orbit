import { UserMenu } from '../layout/UserMenu';
import { SidebarToggle } from '../layout/SidebarToggle';

/**
 * 아틀라스 상단 바. 네비게이터 오른쪽 영역에만 걸치며,
 * 구성(토글 · 프로필)은 메인 페이지 상단 바와 동일하다.
 * 워크스페이스(내 Orbit / 팀 Orbit) 전환은 프로필 메뉴에 있다.
 */
interface AtlasHeaderProps {
  navOpen: boolean;
  onToggleNav: () => void;
}

export function AtlasHeader({ navOpen, onToggleNav }: AtlasHeaderProps) {
  return (
    <header className="atlas-header">
      <SidebarToggle open={navOpen} onToggle={onToggleNav} />
      <UserMenu />
    </header>
  );
}
