import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Settings, LogOut } from 'lucide-react';
import { useAuth } from '../../../../lib/useAuth';
import { SettingsPanel } from './SettingsPanel';

/**
 * 우측 상단 프로필 — 클릭하면 계정/설정 메뉴가 아래로 열린다.
 * 설정 진입점을 여기에 모아서 상단 바에는 아바타 하나만 남긴다.
 */

/** 이름/이메일에서 아바타에 넣을 두 글자를 뽑는다. */
function initials(name: string | null, email: string): string {
  const source = name?.trim() || email;
  return source.slice(0, 2);
}

export function UserMenu() {
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { session, signOut } = useAuth();
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
        {session?.user.picture ? (
          <img className="user-menu__photo" src={session.user.picture} alt="" />
        ) : (
          <span className="user-menu__avatar">
            {session ? initials(session.user.name, session.user.email) : '?'}
          </span>
        )}
        <ChevronDown size={14} className="user-menu__caret" />
      </button>

      {open && (
        <div className="user-menu__panel" role="menu">
          <div className="user-menu__plan">
            <div className="user-menu__plan-name">{session?.user.name ?? '내 계정'}</div>
            <div className="user-menu__plan-meta">{session?.user.email ?? ''}</div>
          </div>

          <div className="user-menu__group">
            <button
              type="button"
              className="user-menu__item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setSettingsOpen(true);
              }}
            >
              <Settings size={15} />
              <span>설정</span>
            </button>
          </div>

          <div className="user-menu__group">
            <button
              type="button"
              className="user-menu__item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void signOut();
              }}
            >
              <LogOut size={15} />
              <span>로그아웃</span>
            </button>
          </div>
        </div>
      )}

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
