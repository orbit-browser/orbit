import { useMemo, useState } from 'react';
import { Header } from './components/layout/Header';
import { NavigatorDrawer } from './components/layout/NavigatorDrawer';
import { OrbitHero } from './components/sections/OrbitHero';
import { RecentExploration } from './components/sections/RecentExploration';
import type { ExplorationEntry } from './components/sections/RecentExploration';
import { ContinueExploring } from './components/sections/ContinueExploring';
import { ATLAS_ORBITS } from './components/atlas/data';
import { navigateToAtlas } from './lib/navigation';
import { getNavState, useSharedNavState } from './lib/nav-state';
import { restoreSession, type RestoreTarget } from './lib/restore';

/** 아틀라스와 같은 데이터를 그대로 쓴다 — 두 화면이 같은 세션을 가리키도록. */
function pickEntry(orbitId: string, sessionId: string): ExplorationEntry {
  const orbit = ATLAS_ORBITS.find((o) => o.id === orbitId)!;
  return { orbit, session: orbit.sessions.find((s) => s.id === sessionId)! };
}

export default function App() {
  const [searchQuery, setSearchQuery] = useState('');
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const { nav, patch } = useSharedNavState();
  const toggleNav = () => patch({ open: !getNavState().open });

  const recent = useMemo<ExplorationEntry[]>(
    () => [
      pickEntry('first-car', 'car-insurance'),
      pickEntry('kyoto-2024', 'kyoto-ryokan'),
      pickEntry('design-system', 'design-tokens'),
    ],
    []
  );
  const active = useMemo(() => pickEntry('first-car', 'car-compare'), []);
  const recommended = useMemo(
    () => [
      pickEntry('kyoto-2024', 'kyoto-ryokan'),
      pickEntry('gaussian-splatting', '3dgs-survey'),
      pickEntry('jeonse-loan', 'loan-compare'),
    ],
    []
  );

  /**
   * 세션을 열면 별도 상세 모달을 띄우지 않고 그 세션의 대시보드로 이동한다.
   * 네비게이터 상태를 함께 맞춰 두어 대시보드에서 해당 항목이 펼쳐진 채로 보인다.
   */
  const openDashboard = (entry: ExplorationEntry) => {
    patch({
      focusedOrbitId: entry.orbit.id,
      selectedSessionId: entry.session.id,
      selectedPageId: null,
      expandedOrbitIds: new Set([...getNavState().expandedOrbitIds, entry.orbit.id]),
      expandedSessionIds: new Set([...getNavState().expandedSessionIds, entry.session.id]),
    });
    navigateToAtlas({ orbitId: entry.orbit.id, sessionId: entry.session.id });
  };

  const handleRestore = async (entry: ExplorationEntry, target: RestoreTarget) => {
    setRestoreError(await restoreSession(entry.session, target));
  };

  const handleAskAI = (prompt: string) => {
    const hit = recent.find((e) => e.session.title.includes(prompt)) ?? recent[0];
    openDashboard(hit);
  };

  return (
    <div
      className={`home-page${nav.open ? ' home-page--nav-open' : ''}`}
      style={{ '--nav-w': `${nav.width}px` } as React.CSSProperties}
    >
      <NavigatorDrawer open={nav.open} onClose={toggleNav} escapeEnabled />
      <Header navOpen={nav.open} onToggleNav={toggleNav} />

      <div className="app-container">
        <OrbitHero
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onAskAI={handleAskAI}
        />

        {restoreError && (
          <p className="home-error" role="alert">
            {restoreError}
          </p>
        )}

        <main className="main-content">
          <section>
            <RecentExploration items={recent} onSelect={openDashboard} />
          </section>

          <section className="right-column">
            <ContinueExploring
              active={active}
              recommended={recommended}
              onOpenDashboard={openDashboard}
              onRestore={(entry, target) => void handleRestore(entry, target)}
            />
          </section>
        </main>
      </div>
    </div>
  );
}
