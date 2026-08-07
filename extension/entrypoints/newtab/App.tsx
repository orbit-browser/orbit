import { useMemo, useState } from 'react';
import { Header } from './components/layout/Header';
import { NavigatorDrawer } from './components/layout/NavigatorDrawer';
import { AskConversationPanel } from './components/sections/AskConversationPanel';
import { OrbitHero } from './components/sections/OrbitHero';
import { RecentExploration } from './components/sections/RecentExploration';
import type { ExplorationEntry } from './components/sections/RecentExploration';
import { ContinueExploring } from './components/sections/ContinueExploring';
import { useAtlasData } from './hooks/useAtlasData';
import { useRecommendations } from './hooks/useRecommendations';
import { navigateToAtlas } from './lib/navigation';
import { getNavState, useSharedNavState } from './lib/nav-state';
import { restoreSession, type RestoreTarget } from './lib/restore';
import { useAskConversation } from '../shared/hooks/useAskConversation';
import type { Session } from '../../lib/types';

export default function App() {
  const [searchQuery, setSearchQuery] = useState('');
  const [composerMode, setComposerMode] = useState<'search' | 'ai'>('search');
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const atlasQuery = useAtlasData();
  const sessions = atlasQuery.data ?? [];
  const recommendationQuery = useRecommendations();
  const { turns, ask, cancel, startNewConversation, isStreaming } = useAskConversation();

  const { nav, patch } = useSharedNavState();
  const toggleNav = () => patch({ open: !getNavState().open });

  const entries = useMemo<ExplorationEntry[]>(
    () => sessions.map((session) => ({ session })),
    [sessions],
  );
  const recent = entries.slice(0, 3);
  const active = entries[0] ?? null;
  /**
   * 추천 세션 — 서버가 여러 신호 + LLM 리랭킹으로 고른 3개를 쓴다.
   * 서버 추천이 없거나 실패하면 최근 세션으로 대체한다(빈 자리를 남기지 않는다).
   */
  const recommendationItems = recommendationQuery.data?.items ?? [];
  const reasons = useMemo(
    () => new Map(recommendationItems.map((item) => [item.sessionId, item])),
    [recommendationItems],
  );
  const recommended = useMemo(() => {
    const byId = new Map(entries.map((entry) => [entry.session.id, entry]));
    const fromServer = recommendationItems
      .map((item) => byId.get(item.sessionId))
      .filter((entry): entry is ExplorationEntry => entry !== undefined);
    return fromServer.length > 0 ? fromServer : entries.slice(1, 4);
  }, [entries, recommendationItems]);

  const openDashboard = (entry: ExplorationEntry) => {
    patch({
      focusedOrbitId: entry.session.id,
      selectedSessionId: null,
      selectedPageId: null,
      expandedSessionIds: new Set([...getNavState().expandedSessionIds, entry.session.id]),
    });
    navigateToAtlas({ sessionId: entry.session.id });
  };

  const handleRestore = async (entry: ExplorationEntry, target: RestoreTarget) => {
    setRestoreError(await restoreSession(entry.session, target));
  };

  const handleAskAI = (prompt: string) => {
    setSearchQuery('');
    void ask(prompt);
  };

  const openSource = (session: Session) => {
    patch({
      focusedOrbitId: session.id,
      selectedSessionId: null,
      selectedPageId: null,
      expandedSessionIds: new Set([...getNavState().expandedSessionIds, session.id]),
    });
    navigateToAtlas({ sessionId: session.id });
  };

  return (
    <div
      className={`home-page${nav.open ? ' home-page--nav-open' : ''}`}
      style={{ '--nav-w': `${nav.width}px` } as React.CSSProperties}
    >
      <NavigatorDrawer sessions={sessions} open={nav.open} onClose={toggleNav} escapeEnabled />
      <Header navOpen={nav.open} onToggleNav={toggleNav} />

      <div className="app-container">
        <OrbitHero
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onAskAI={handleAskAI}
          isAsking={isStreaming}
          mode={composerMode}
          onModeChange={setComposerMode}
        />

        {restoreError && (
          <p className="home-error" role="alert">
            {restoreError}
          </p>
        )}

        {composerMode === 'ai' && turns.length > 0 ? (
          <AskConversationPanel
            turns={turns}
            isStreaming={isStreaming}
            onCancel={cancel}
            onStartNewConversation={startNewConversation}
            onRetry={(query) => void ask(query)}
            onOpenSource={openSource}
          />
        ) : atlasQuery.isPending ? (
          <div className="home-data-state" role="status">탐색 기록을 불러오는 중...</div>
        ) : atlasQuery.isError ? (
          <div className="home-data-state home-data-state--error" role="alert">
            <span>백엔드에서 탐색 기록을 불러오지 못했어요.</span>
            <button type="button" onClick={() => void atlasQuery.refetch()}>다시 시도</button>
          </div>
        ) : entries.length === 0 ? (
          <div className="home-data-state">
            아직 저장된 탐색 세션이 없습니다. 사이드패널에서 탭을 저장하거나 동기화해 보세요.
          </div>
        ) : (
          <main className="main-content">
            <section>
              <RecentExploration items={recent} onSelect={openDashboard} />
            </section>

            <section className="right-column">
              <ContinueExploring
                active={active}
                recommended={recommended}
                reasons={reasons}
                onOpenDashboard={openDashboard}
                onRestore={(entry, target) => void handleRestore(entry, target)}
              />
            </section>
          </main>
        )}
      </div>
    </div>
  );
}
