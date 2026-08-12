import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Database,
  Download,
  Info,
  Layers,
  Plug,
  Search,
  Shield,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { checkHealth, fetchServerSettings, updateServerSettings } from '../../../../lib/api';
import { useAuth } from '../../../../lib/useAuth';
import { useOrbitSettings } from '../../hooks/useOrbitSettings';
import { SETTINGS_PAGES } from './SettingsPages';
import { filterSettingsNav, type SettingsNavItem, type SettingsPageId } from './settings-nav';

const NAV_ICONS: Record<SettingsNavItem['icon'], typeof SlidersHorizontal> = {
  sliders: SlidersHorizontal,
  download: Download,
  layers: Layers,
  sparkles: Sparkles,
  shield: Shield,
  database: Database,
  plug: Plug,
  info: Info,
};

/**
 * 설정 작업 공간 — 왼쪽에서 분류를 고르고 오른쪽에 그 분류의 설정만 놓는다.
 *
 * 설정 전부를 한 줄로 늘어놓으면 무엇이 어디 있는지 목록을 끝까지 훑어야만 알 수 있다.
 * 값 자체는 사이드패널 설정과 같은 곳(`chrome.storage.local` · 서버 `/settings`)을 본다.
 *
 * body 로 포털한다 — 프로필 메뉴 안에 두면 그 컨테이너의 위치·겹침 규칙에 갇힌다.
 */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState<SettingsPageId>('general');
  const [query, setQuery] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);

  const { settings, patch } = useOrbitSettings();
  const { session, signOut } = useAuth();
  const queryClient = useQueryClient();

  const health = useQuery({
    queryKey: ['health'],
    queryFn: checkHealth,
    refetchInterval: 10_000,
    retry: false,
  });

  const serverSettings = useQuery({
    queryKey: ['server-settings'],
    queryFn: fetchServerSettings,
    retry: false,
  });

  const saveServerSettings = useMutation({
    mutationFn: updateServerSettings,
    onSuccess: (data) => queryClient.setQueryData(['server-settings'], data),
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // 분류를 옮기면 앞 화면에서 내려 둔 자리가 아니라 맨 위에서 시작한다.
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [page]);

  const groups = useMemo(() => filterSettingsNav(query), [query]);
  const Page = SETTINGS_PAGES[page];

  return createPortal(
    <div
      className="settings-overlay"
      // 바깥(딤)을 누르기 시작했을 때만 닫는다 — 안에서 시작한 드래그가 밖에서 끝나도 닫히지 않는다.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="settings-shell" role="dialog" aria-modal="true" aria-label="설정">
        <nav className="settings-nav" aria-label="설정 분류">
          <div className="settings-nav__search">
            <Search size={14} />
            <input
              type="search"
              value={query}
              placeholder="설정 검색"
              aria-label="설정 검색"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          <div className="settings-nav__scroll">
            {groups.map((group) => (
              <div className="settings-nav__group" key={group.title}>
                <p className="settings-nav__group-title">{group.title}</p>
                {group.items.map((item) => {
                  const Icon = NAV_ICONS[item.icon];
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`settings-nav__item${page === item.id ? ' settings-nav__item--on' : ''}`}
                      aria-current={page === item.id ? 'page' : undefined}
                      onClick={() => setPage(item.id)}
                    >
                      <Icon size={15} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}

            {groups.length === 0 && (
              <p className="settings-nav__empty">“{query}” 와 맞는 설정이 없습니다</p>
            )}
          </div>
        </nav>

        <div className="settings-content">
          <button
            type="button"
            className="settings-content__close"
            aria-label="설정 닫기"
            onClick={onClose}
          >
            <X size={15} />
          </button>

          <div className="settings-content__scroll" ref={contentRef}>
            {/* key 로 다시 마운트해 분류가 바뀐 것이 눈에 보이게 한다. */}
            <div className="settings-page" key={page}>
              <Page
                settings={settings}
                patch={patch}
                health={health}
                serverSettings={serverSettings}
                saveServerSettings={(value) => saveServerSettings.mutate(value)}
                serverBusy={
                  serverSettings.isLoading || serverSettings.isError || saveServerSettings.isPending
                }
                account={session?.user.email ?? null}
                onSignOut={() => {
                  onClose();
                  void signOut();
                }}
                onNavigate={setPage}
              />
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
