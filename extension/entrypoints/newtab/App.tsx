import { useMemo, useState } from 'react';
import { Header } from './components/layout/Header';
import { NavigatorDrawer } from './components/layout/NavigatorDrawer';
import { AskConversationPanel } from './components/sections/AskConversationPanel';
import { OrbitHero } from './components/sections/OrbitHero';
import { RecentExploration } from './components/sections/RecentExploration';
import type { ExplorationEntry } from './components/sections/RecentExploration';
import { ContinueExploring } from './components/sections/ContinueExploring';
import { EmptyStateActions } from './components/sections/EmptyStateActions';
import { useAtlasData, useFolderSuggestions } from './hooks/useAtlasData';
import { useRecommendations } from './hooks/useRecommendations';
import { navigateToAtlas } from './lib/navigation';
import { getNavState, useSharedNavState } from './lib/nav-state';
import { restoreSession, type RestoreTarget } from './lib/restore';
import { useAskConversation } from '../shared/hooks/useAskConversation';
import { useActiveWorkspace } from '../../lib/useWorkspaces';
import { TeamCollectPanel } from './components/team/TeamCollect';
import { SnapshotPrompt } from './components/sections/SnapshotPrompt';
import type { Session } from '../../lib/types';

export default function App() {
  const [searchQuery, setSearchQuery] = useState('');
  const [composerMode, setComposerMode] = useState<'search' | 'ai'>('search');
  const [restoreError, setRestoreError] = useState<string | null>(null);
  // 프로필 메뉴에서 고른 워크스페이스(내 Orbit / 팀 Orbit)를 홈도 따라간다.
  const { scopeId, active: activeTeam } = useActiveWorkspace({ pollTeams: true });
  const atlasQuery = useAtlasData(scopeId);
  const sessions = atlasQuery.data?.sessions ?? [];
  const folders = atlasQuery.data?.folders ?? [];
  const unfiled = atlasQuery.data?.unfiled ?? [];
  const suggestions = useFolderSuggestions(atlasQuery.data, atlasQuery.dataUpdatedAt, !scopeId);
  const recommendationQuery = useRecommendations();
  // 홈 Ask 도 지금 보고 있는 범위를 근거로 답한다(사이드패널과 같다). 범위가 바뀌면 훅이 대화를 비운다.
  const {
    turns,
    ask,
    cancel,
    startNewConversation,
    isStreaming,
    selectTabCandidate,
  } = useAskConversation({ workspaceId: scopeId ?? undefined });

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
      <NavigatorDrawer
        sessions={sessions}
        folders={folders}
        unfiled={unfiled}
        suggestions={suggestions}
        readOnly={!!scopeId}
        open={nav.open}
        onClose={toggleNav}
        escapeEnabled
      />
      <Header navOpen={nav.open} onToggleNav={toggleNav} />

      <div className="app-container">
        {activeTeam && <TeamCollectPanel team={activeTeam} />}
        <OrbitHero
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onAskAI={handleAskAI}
          isAsking={isStreaming}
          mode={composerMode}
          onModeChange={setComposerMode}
        />

        {/* 지난 기록이 회색 칸뿐인 까닭이 미리보기가 꺼져서라면 여기서 바로 켠다(팀 범위에서는 남의 세션이라 묻지 않는다). */}
        {!scopeId && <SnapshotPrompt placement="home" />}

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
            onSelectTabCandidate={(turnId, tabId) => void selectTabCandidate(turnId, tabId)}
          />
        ) : atlasQuery.isPending ? (
          <div className="home-data-state" role="status">탐색 기록을 불러오는 중...</div>
        ) : atlasQuery.isError ? (
          <div className="home-data-state home-data-state--error" role="alert">
            <span>백엔드에서 탐색 기록을 불러오지 못했어요.</span>
            <div className="data-state__actions">
              <button
                type="button"
                className="data-state__primary"
                disabled={atlasQuery.isFetching}
                onClick={() => void atlasQuery.refetch()}
              >
                {atlasQuery.isFetching ? '다시 불러오는 중…' : '다시 시도'}
              </button>
            </div>
          </div>
        ) : entries.length === 0 ? (
          <div className="home-data-state">
            {scopeId
              ? '이 팀에 공유된 세션이 아직 없어요. 내 세션을 팀에 공유하거나 팀원을 초대해 보세요.'
              : '아직 저장된 탐색 세션이 없습니다. 사이드패널에서 수집을 켜거나 탭을 저장해 보세요.'}
            <EmptyStateActions team={activeTeam} />
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
