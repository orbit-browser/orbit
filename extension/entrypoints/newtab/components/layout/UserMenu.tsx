import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Settings, LogOut } from 'lucide-react';
import { useAuth } from '../../../../lib/useAuth';
import { hueForSession } from '../../../../lib/session-hue';
import { useActiveWorkspace } from '../../../../lib/useWorkspaces';
import { SettingsPanel } from './SettingsPanel';

/**
 * 우측 상단 프로필 — 클릭하면 계정/워크스페이스/설정 메뉴가 아래로 열린다.
 * 설정 진입점을 여기에 모아서 상단 바에는 아바타 하나만 남긴다.
 *
 * 워크스페이스는 노션처럼 "내 Orbit"과 "<팀> Orbit" 사이를 옮겨 다닌다. 고른 곳은 설정에
 * 저장돼 홈·아틀라스·사이드패널이 함께 따라간다. 팀이 하나도 없으면 목록을 그리지 않는다.
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
  const { workspaces, scopeId, select } = useActiveWorkspace();
  const wrapRef = useRef<HTMLDivElement>(null);
  const me = session ? initials(session.user.name, session.user.email) : '?';
  const spaces = [
    { id: null, name: '내 Orbit', icon: me.charAt(0), hue: undefined },
    ...workspaces.map((workspace) => ({
      id: workspace.id,
      name: `${workspace.name} Orbit`,
      icon: workspace.name.trim().charAt(0) || '팀',
      hue: hueForSession(workspace.id),
    })),
  ];
  const current = spaces.find((space) => space.id === scopeId) ?? spaces[0];

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
        {workspaces.length > 0 && <span className="user-menu__workspace">{current.name}</span>}
        {session?.user.picture ? (
          <img className="user-menu__photo" src={session.user.picture} alt="" />
        ) : (
          <span className="user-menu__avatar">
            {me}
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

          {workspaces.length > 0 && (
            <div className="user-menu__group" role="group" aria-label="워크스페이스">
              {spaces.map((space) => {
                const active = space.id === current.id;
                return (
                  <button
                    key={space.id ?? 'me'}
                    type="button"
                    className={`user-menu__item user-menu__space${active ? ' user-menu__space--active' : ''}`}
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => {
                      setOpen(false);
                      if (!active) select(space.id);
                    }}
                  >
                    <span
                      className="user-menu__space-icon"
                      style={space.hue ? ({ '--space-hue': space.hue } as React.CSSProperties) : undefined}
                    >
                      {space.icon}
                    </span>
                    <span className="user-menu__space-name">{space.name}</span>
                    {active && <Check size={15} className="user-menu__check" />}
                  </button>
                );
              })}
            </div>
          )}

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
