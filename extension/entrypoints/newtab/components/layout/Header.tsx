import { UserMenu } from './UserMenu';
import { SidebarToggle } from './SidebarToggle';

/**
 * 메인 페이지 상단 바. 화면 양 끝에 붙는 고정 바이며,
 * 네비게이터가 열리면 왼쪽 끝이 그만큼 밀린다.
 */
interface HeaderProps {
  navOpen: boolean;
  onToggleNav: () => void;
}

export function Header({ navOpen, onToggleNav }: HeaderProps) {
  return (
    <header className="app-bar">
      <SidebarToggle open={navOpen} onToggle={onToggleNav} />
      <UserMenu />
    </header>
  );
}
