import { PanelLeft } from 'lucide-react';

interface SidebarToggleProps {
  open: boolean;
  onToggle: () => void;
}

/** 좌측 네비게이터를 여닫는 토글. 메인·아틀라스 상단 바 맨 왼쪽에 동일하게 놓인다. */
export function SidebarToggle({ open, onToggle }: SidebarToggleProps) {
  return (
    <button
      type="button"
      className={`sidebar-toggle${open ? ' sidebar-toggle--on' : ''}`}
      onClick={onToggle}
      aria-label={open ? '네비게이터 닫기' : '네비게이터 열기'}
      aria-pressed={open}
      title={open ? '네비게이터 닫기' : '네비게이터 열기'}
    >
      <PanelLeft size={17} />
    </button>
  );
}
