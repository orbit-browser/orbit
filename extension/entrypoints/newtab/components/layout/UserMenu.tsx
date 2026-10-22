import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, LogIn, LogOut, MoreHorizontal, Plus, Settings } from 'lucide-react';
import { useAuth } from '../../../../lib/useAuth';
import { hueForSession } from '../../../../lib/session-hue';
import { useActiveWorkspace } from '../../../../lib/useWorkspaces';
import { useWorkspaceMutations } from '../../../sidepanel/hooks/useWorkspaces';
import { useOrbitSettings } from '../../hooks/useOrbitSettings';
import { SettingsPanel } from './SettingsPanel';
import { personalName } from './SettingsPages';
import type { SettingsPageId } from './settings-nav';

/**
 * 우측 상단 프로필 — 클릭하면 계정/워크스페이스/설정 메뉴가 아래로 열린다.
 * 설정 진입점을 여기에 모아서 상단 바에는 버튼 하나만 남긴다.
 *
 * 워크스페이스는 노션처럼 내 Orbit 과 팀 워크스페이스 사이를 옮겨 다닌다. 고른 곳은 설정에
 * 저장돼 홈·아틀라스·사이드패널이 함께 따라간다. 팀이 있으면 버튼이 지금 워크스페이스
 * (아이콘 + 이름)를 보여 주고, 팀이 하나도 없으면 예전처럼 아바타만 보인다.
 * 내 Orbit 의 아이콘은 내 아바타(동그라미), 팀은 팀 색의 옅은 네모라 한눈에 갈린다.
 *
 * 워크스페이스를 오른쪽 클릭하거나(또는 ⋯) 이름 변경·초대·설정을 고른다. 목록 아래에서
 * 새 워크스페이스를 만들거나 초대 코드로 참여한다.
 */

/** 이름/이메일에서 아바타에 넣을 두 글자를 뽑는다. */
function initials(name: string | null, email: string): string {
  const source = name?.trim() || email;
  return source.slice(0, 2);
}

interface Space {
  /** null 이면 내 Orbit */
  id: string | null;
  name: string;
  hue: string | null;
  letter: string;
  /** 이름 변경·초대를 할 수 있는지 — 팀은 소유자만, 내 Orbit 은 늘 */
  canManage: boolean;
}

export function UserMenu() {
  const [open, setOpen] = useState(false);
  const [settingsFor, setSettingsFor] = useState<{ page: SettingsPageId; workspaceId?: string | null } | null>(null);
  /** 오른쪽 클릭 메뉴 — 어느 워크스페이스의, 패널 안 어느 자리에 */
  const [context, setContext] = useState<{ space: Space; x: number; y: number } | null>(null);
  /** 이름을 고치는 중인 워크스페이스(null = 내 Orbit). undefined 면 고치는 중이 아니다. */
  const [renaming, setRenaming] = useState<string | null | undefined>(undefined);
  /** 목록 아래 입력 칸 — 새로 만들기 또는 초대 코드로 참여 */
  const [form, setForm] = useState<'create' | 'join' | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const { session, signOut } = useAuth();
  const { workspaces, scopeId, select } = useActiveWorkspace();
  const { settings, patch } = useOrbitSettings();
  const mutations = useWorkspaceMutations();
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const me = session ? initials(session.user.name, session.user.email) : '?';
  const avatar = session?.user.picture ? (
    <img className="user-menu__photo" src={session.user.picture} alt="" />
  ) : (
    <span className="user-menu__avatar">{me}</span>
  );
  const spaces: Space[] = [
    { id: null, name: personalName(settings), hue: null, letter: '', canManage: true },
    ...workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      hue: hueForSession(workspace.id),
      letter: workspace.name.trim().charAt(0) || '팀',
      canManage: workspace.role === 'owner',
    })),
  ];
  const current = spaces.find((space) => space.id === scopeId) ?? spaces[0];
  const icon = (space: Space) =>
    space.hue ? (
      <span className="user-menu__space-icon" style={{ '--space-hue': space.hue } as React.CSSProperties}>
        {space.letter}
      </span>
    ) : (
      <span className="user-menu__space-me">{avatar}</span>
    );

  const close = () => {
    setOpen(false);
    setContext(null);
    setRenaming(undefined);
    setForm(null);
    setFormError(null);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    };
    // Esc 는 가장 안쪽부터 닫는다 — 오른쪽 클릭 메뉴, 입력 칸, 그다음 메뉴 전체.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (context) setContext(null);
      else if (renaming !== undefined || form) {
        setRenaming(undefined);
        setForm(null);
        setFormError(null);
      } else close();
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  });

  const openContext = (space: Space, clientX: number, clientY: number) => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    // 패널 오른쪽 끝을 넘지 않게 — 메뉴 폭(176px)만큼 안쪽에 붙인다.
    setContext({ space, x: Math.min(clientX - rect.left, rect.width - 184), y: clientY - rect.top });
  };

  const saveName = (space: Space, raw: string) => {
    const name = raw.trim();
    setRenaming(undefined);
    if (space.id === null) patch({ personalWorkspaceName: name || null });
    else if (name && name !== space.name) mutations.rename.mutate({ workspaceId: space.id, name });
  };

  const submitForm = (raw: string) => {
    const value = raw.trim();
    if (!value) {
      setFormError(form === 'create' ? '이름을 입력해 주세요.' : '초대 코드를 입력해 주세요.');
      return;
    }
    setFormError(null);
    const onSuccess = (workspace: { id: string }) => {
      select(workspace.id);
      close();
    };
    if (form === 'create') {
      mutations.create.mutate(value, { onSuccess, onError: () => setFormError('만들지 못했어요. 잠시 뒤 다시 시도해 주세요.') });
    } else {
      mutations.join.mutate(value, { onSuccess, onError: () => setFormError('코드가 맞지 않거나 만료됐어요.') });
    }
  };

  return (
    <div className="user-menu" ref={wrapRef}>
      <button
        type="button"
        className={`user-menu__trigger${open ? ' user-menu__trigger--open' : ''}`}
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {workspaces.length > 0 ? (
          <>
            {icon(current)}
            <span className="user-menu__workspace">{current.name}</span>
          </>
        ) : (
          avatar
        )}
        <ChevronDown size={14} className="user-menu__caret" />
      </button>

      {open && (
        <div
          className="user-menu__panel"
          role="menu"
          ref={panelRef}
          onPointerDown={(event) => {
            // 패널 안 다른 곳을 누르면 오른쪽 클릭 메뉴만 닫는다.
            if (context && !(event.target as HTMLElement).closest('.user-menu__context')) setContext(null);
          }}
        >
          <div className="user-menu__plan">
            <div className="user-menu__plan-name">{session?.user.name ?? '내 계정'}</div>
            <div className="user-menu__plan-meta">{session?.user.email ?? ''}</div>
          </div>

          <div className="user-menu__group" role="group" aria-label="워크스페이스">
            <div className="user-menu__label">워크스페이스</div>
            {spaces.map((space) => {
              const active = space.id === current.id;
              if (renaming === space.id) {
                return (
                  <div key={space.id ?? 'me'} className="user-menu__item user-menu__space">
                    {icon(space)}
                    <input
                      className="user-menu__input"
                      defaultValue={space.id === null ? settings.personalWorkspaceName ?? '' : space.name}
                      placeholder="내 Orbit"
                      maxLength={60}
                      autoFocus
                      aria-label="워크스페이스 이름"
                      onFocus={(event) => event.currentTarget.select()}
                      onBlur={(event) => saveName(space, event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                      }}
                    />
                  </div>
                );
              }
              return (
                <div key={space.id ?? 'me'} className="user-menu__space-row">
                  <button
                    type="button"
                    className={`user-menu__item user-menu__space${active ? ' user-menu__space--active' : ''}`}
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => {
                      close();
                      if (!active) select(space.id);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      openContext(space, event.clientX, event.clientY);
                    }}
                  >
                    {icon(space)}
                    <span className="user-menu__space-name">{space.name}</span>
                    {active && <Check size={15} className="user-menu__check" />}
                  </button>
                  <button
                    type="button"
                    className="user-menu__more"
                    aria-label={`${space.name} 메뉴`}
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      openContext(space, rect.left, rect.bottom);
                    }}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                </div>
              );
            })}

            {form ? (
              <div className="user-menu__form">
                <input
                  className="user-menu__input"
                  placeholder={form === 'create' ? '내 Orbit' : '초대 코드'}
                  maxLength={form === 'create' ? 60 : 64}
                  autoFocus
                  aria-label={form === 'create' ? '새 워크스페이스 이름' : '초대 코드'}
                  disabled={mutations.create.isPending || mutations.join.isPending}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') submitForm(event.currentTarget.value);
                  }}
                />
                <span className="user-menu__form-hint">
                  {form === 'create' ? '엔터로 만들기 · 이름은 나중에 바꿀 수 있어요' : '엔터로 참여'}
                </span>
                {formError && (
                  <span className="user-menu__form-error" role="alert">
                    {formError}
                  </span>
                )}
              </div>
            ) : (
              <>
                <button type="button" className="user-menu__item user-menu__add" onClick={() => setForm('create')}>
                  <Plus size={15} />
                  <span>새 워크스페이스</span>
                </button>
                <button type="button" className="user-menu__item user-menu__add" onClick={() => setForm('join')}>
                  <LogIn size={15} />
                  <span>초대 코드로 참여</span>
                </button>
              </>
            )}
          </div>

          <div className="user-menu__group">
            <button
              type="button"
              className="user-menu__item"
              role="menuitem"
              onClick={() => {
                close();
                setSettingsFor({ page: 'general' });
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
                close();
                void signOut();
              }}
            >
              <LogOut size={15} />
              <span>로그아웃</span>
            </button>
          </div>

          {context && (
            <div className="user-menu__context" role="menu" style={{ left: context.x, top: context.y }}>
              {context.space.canManage && (
                <button
                  type="button"
                  className="user-menu__item"
                  role="menuitem"
                  onClick={() => {
                    setRenaming(context.space.id);
                    setContext(null);
                  }}
                >
                  이름 변경
                </button>
              )}
              {context.space.id !== null && context.space.canManage && (
                <button
                  type="button"
                  className="user-menu__item"
                  role="menuitem"
                  onClick={() => {
                    const workspaceId = context.space.id;
                    close();
                    setSettingsFor({ page: 'workspace', workspaceId });
                  }}
                >
                  초대하기
                </button>
              )}
              <button
                type="button"
                className="user-menu__item"
                role="menuitem"
                onClick={() => {
                  const workspaceId = context.space.id;
                  close();
                  setSettingsFor({ page: 'workspace', workspaceId });
                }}
              >
                워크스페이스 설정
              </button>
            </div>
          )}
        </div>
      )}

      {settingsFor && (
        <SettingsPanel
          initialPage={settingsFor.page}
          workspaceId={settingsFor.workspaceId}
          onClose={() => setSettingsFor(null)}
        />
      )}
    </div>
  );
}
