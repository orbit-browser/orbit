import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Gift, Settings, MessageSquare, Users, ArrowUpRight, LogOut } from 'lucide-react';

/**
 * 우측 상단 프로필 — 클릭하면 계정/설정 메뉴가 아래로 열린다.
 * 설정 진입점을 여기에 모아서 상단 바에는 아바타 하나만 남긴다.
 */

const USER_NAME = '전준';

export function UserMenu() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="user-menu" ref={wrapRef}>
      <button
        type="button"
        className={`user-menu__trigger${open ? ' user-menu__trigger--open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="user-menu__avatar">{USER_NAME}</span>
        <ChevronDown size={14} className="user-menu__caret" />
      </button>

      {open && (
        <div className="user-menu__panel" role="menu">
          <div className="user-menu__plan">
            <div className="user-menu__plan-name">무료 플랜</div>
            <div className="user-menu__plan-meta">이번 달 AI 요약 16% 남음</div>
          </div>

          <div className="user-menu__group">
            <button type="button" className="user-menu__item" role="menuitem">
              <Gift size={15} />
              <span>친구 초대</span>
            </button>
          </div>

          <div className="user-menu__group">
            <button type="button" className="user-menu__item" role="menuitem">
              <Settings size={15} />
              <span>설정</span>
            </button>
            <button type="button" className="user-menu__item" role="menuitem">
              <MessageSquare size={15} />
              <span>의견 보내기</span>
            </button>
            <button type="button" className="user-menu__item" role="menuitem">
              <Users size={15} />
              <span>커뮤니티 참여</span>
              <ArrowUpRight size={13} className="user-menu__external" />
            </button>
          </div>

          <div className="user-menu__group">
            <button type="button" className="user-menu__item" role="menuitem">
              <LogOut size={15} />
              <span>로그아웃</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
