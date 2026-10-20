/**
 * 방향 ① 기록 보관소 — 종이·명조·모노 라벨·가는 선. 근거: Sine & Notation, Transcription,
 * Ephemeral Topography, Fig Mint(변형 커뮤니티). 세션은 번호가 매겨진 아카이브 항목이고, 궤도는 잉크 등고선이다.
 */
import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import {
  RECOMMENDATIONS, SCOPES, SHORTCUTS, clock, duration, favicon, matches, orbitPoint, pad, relativeDay, shortDate,
  useMockState, wavePath, type MockSession,
} from './data';
import './archive.css';

type State = ReturnType<typeof useMockState>;

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function Masthead({ state }: { state: State }) {
  const now = useNow();
  const team = state.scope.id !== null;
  return (
    <header className="ar-mast">
      <div className="ar-mono ar-mast-left">
        <span className="ar-mark" aria-hidden>◎</span>
        ORBIT · {team ? `SHARED ARCHIVE — ${state.scope.name}` : 'PERSONAL ARCHIVE'}
      </div>
      <nav className="ar-mono ar-tabs" aria-label="화면">
        {(['home', 'atlas'] as const).map((view) => (
          <button key={view} type="button" className={state.view === view ? 'is-on' : ''} onClick={() => state.setView(view)}>
            {view === 'home' ? 'Home' : 'Atlas'}
          </button>
        ))}
      </nav>
      <div className="ar-mono ar-mast-right">
        <span>{now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()} · {clock(now)}</span>
        <label className="ar-scope">
          <span className="ar-visually-hidden">보고 있는 기록</span>
          <select value={state.scope.id ?? ''} onChange={(event) => state.changeScope(event.target.value || null)}>
            {SCOPES.map((scope) => <option key={scope.id ?? 'me'} value={scope.id ?? ''}>{scope.name}</option>)}
          </select>
        </label>
        <span className="ar-stamp" title="김오르빗">오빗</span>
      </div>
    </header>
  );
}

function SpecGrid({ session }: { session: MockSession }) {
  const rows: [string, string][] = [
    ['Pages', `${session.pages.length}`],
    ['Active', duration(session.minutes)],
    ['Last visit', `${relativeDay(session.lastActivity)} ${clock(session.lastActivity)}`],
    [session.sharedBy ? 'Filed by' : 'Folder', session.sharedBy?.name ?? session.folder?.name ?? '—'],
  ];
  return (
    <dl className="ar-spec">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="ar-mono">{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Home({ state }: { state: State }) {
  const team = state.scope.id !== null;
  const featured = state.sessions[0];
  const rows = state.sessions.filter((s) => matches(s, state.query));
  const totalMinutes = state.sessions.reduce((sum, s) => sum + s.minutes, 0);
  return (
    <main className="ar-home">
      <section className="ar-hero">
        <div className="ar-hero-copy">
          <p className="ar-mono ar-kicker">
            Vol. 10 — {team ? '공동 탐색 기록' : '탐색 기록 보관소'} · {pad(state.sessions.length, 2)} entries · {duration(totalMinutes)}
          </p>
          <h1 className="ar-display">
            어제 보던 곳에서,<br />
            <em>다시</em> 시작해요.
          </h1>
          <form className="ar-search" onSubmit={(event) => event.preventDefault()}>
            <input
              value={state.query}
              onChange={(event) => state.setQuery(event.target.value)}
              placeholder="무엇을 찾았었나요?"
              aria-label="기록 검색"
            />
            <div className="ar-search-actions">
              <button type="submit" className="ar-mono">Search ↵</button>
              <button type="button" className="ar-mono ar-ghost">Ask AI ⇥</button>
            </div>
          </form>
          <ul className="ar-shortcuts ar-mono" aria-label="바로가기">
            {SHORTCUTS.map((s) => (
              <li key={s.domain}><img src={favicon(s.domain)} alt="" />{s.title}</li>
            ))}
          </ul>
        </div>

        {featured && (
          <article className="ar-featured">
            <p className="ar-mono ar-label">Continue — № {pad(featured.number)}</p>
            <h2 className="ar-title">{featured.title}</h2>
            <p className="ar-body">{featured.overview || '요약을 만드는 중이에요.'}</p>
            <SpecGrid session={featured} />
            <div className="ar-actions">
              <button type="button" className="ar-pill">이어서 열기 →</button>
              <button type="button" className="ar-link ar-mono" onClick={() => state.openInAtlas(featured.id)}>아틀라스에서 보기</button>
            </div>
          </article>
        )}
      </section>

      <section className="ar-index" aria-label="최근 탐색">
        <header className="ar-index-head">
          <span className="ar-mono">Index</span>
          <h3>최근 탐색</h3>
          <span className="ar-mono">{rows.length} / {state.sessions.length}</span>
        </header>
        {rows.length === 0 && <p className="ar-empty">이 검색어로 찾은 기록이 없어요.</p>}
        <ol>
          {rows.map((session, index) => (
            <li key={session.id}>
              <button type="button" className="ar-row" onClick={() => state.openInAtlas(session.id)}>
                <svg className="ar-wave" viewBox="0 0 1000 80" preserveAspectRatio="none" aria-hidden>
                  <path d={wavePath(session.pages.map((p) => p.minutes), 1000, 80, index)} />
                  <path d={wavePath(session.pages.map((p) => p.minutes), 1000, 80, index + 1.7)} />
                </svg>
                <span className="ar-mono ar-row-no">№ {pad(session.number)}</span>
                <span className="ar-mono ar-row-date">{shortDate(session.lastActivity)} · {relativeDay(session.lastActivity)}</span>
                <span className="ar-row-title">
                  {session.title}
                  {session.pending && <em className="ar-mono ar-pending"> · 요약 중</em>}
                </span>
                <span className="ar-mono ar-row-meta">
                  {session.sharedBy && <span className="ar-stamp ar-stamp-sm">{session.sharedBy.initials}</span>}
                  {[...new Set(session.pages.map((p) => p.domain.split('.')[0]))].slice(0, 3).join(' · ')}
                  {session.pages.length > 3 ? ` +${session.pages.length - 3}` : ''}
                </span>
                <span className="ar-mono ar-row-min">{session.minutes}′</span>
              </button>
            </li>
          ))}
        </ol>
      </section>

      {!team && (
        <section className="ar-marginalia" aria-label="추천">
          <p className="ar-mono ar-label">Marginalia — 지금 다시 볼 만한 기록</p>
          <div className="ar-notes">
            {RECOMMENDATIONS.map(({ session, kind, reason }) => (
              <button key={session.id} type="button" className="ar-note" onClick={() => state.openInAtlas(session.id)}>
                <span className="ar-mono">→ {kind}</span>
                <span className="ar-note-reason">{reason}</span>
                <span className="ar-note-title">№ {pad(session.number)} {session.title}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

/** 잉크 등고선: 고르지 않은 동심원. 세션마다 모양이 조금씩 다르다. */
function contour(radius: number, seed: number, wobble: number, cx: number, cy: number): string {
  const points: string[] = [];
  for (let i = 0; i <= 120; i += 1) {
    const a = (i / 120) * Math.PI * 2;
    const r = radius + Math.sin(a * 3 + seed) * wobble + Math.cos(a * 5 + seed * 1.7) * wobble * 0.6;
    points.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return `M${points.join(' L')}Z`;
}

function Orbit({ state, session }: { state: State; session: MockSession }) {
  const size = 560;
  const c = size / 2;
  const main = 210;
  const seed = session.number * 0.9;
  return (
    <div className="ar-orbit">
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${session.title} 궤도`}>
        {[0.42, 0.56, 0.7, 0.86, 1, 1.14, 1.28].map((k, i) => (
          <path key={k} d={contour(main * k, seed + i * 0.6, 4 + i * 2.2, c, c)} className={k === 1 ? 'ar-ring-main' : 'ar-ring'} />
        ))}
        {session.pages.map((page, index) => {
          const p = orbitPoint(index, session.pages.length, state.pageIndex, main, c, c);
          const on = index === state.pageIndex;
          return (
            <g key={page.id} className={`ar-node${on ? ' is-on' : ''}`} style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
              onClick={() => state.setPageIndex(index)}>
              <circle r={on ? 7 : 3.5} />
              {on && <line x1={0} y1={10} x2={0} y2={34} />}
            </g>
          );
        })}
      </svg>
      <div className="ar-orbit-center">
        <p className="ar-mono">№ {pad(session.number)} · {session.pages.length} pages · {session.minutes}′</p>
        <h2>{session.title}</h2>
      </div>
      {session.pages[state.pageIndex] && (
        <div className="ar-orbit-caption">
          <img src={favicon(session.pages[state.pageIndex].domain)} alt="" />
          <span className="ar-caption-title">{session.pages[state.pageIndex].title}</span>
          <span className="ar-mono">{session.pages[state.pageIndex].domain} · {session.pages[state.pageIndex].minutes}′ · {clock(session.pages[state.pageIndex].visitedAt)}</span>
        </div>
      )}
      <div className="ar-orbit-nav ar-mono">
        <button type="button" onClick={() => state.setPageIndex((state.pageIndex - 1 + session.pages.length) % session.pages.length)}>←</button>
        <span>{pad(state.pageIndex + 1, 2)} / {pad(session.pages.length, 2)}</span>
        <button type="button" onClick={() => state.setPageIndex((state.pageIndex + 1) % session.pages.length)}>→</button>
      </div>
    </div>
  );
}

function Atlas({ state }: { state: State }) {
  const session = state.selected;
  const team = state.scope.id !== null;
  const groups = new Map<string, MockSession[]>();
  state.sessions.forEach((s) => {
    const key = team ? s.sharedBy?.name ?? '—' : s.folder?.name ?? '미분류';
    groups.set(key, [...(groups.get(key) ?? []), s]);
  });
  return (
    <main className="ar-atlas">
      <aside className="ar-nav" aria-label="세션 목록">
        {team && (
          <div className="ar-contrib">
            <p className="ar-mono ar-label">Contributors</p>
            <div className="ar-chips">
              <button type="button" className={`ar-mono${state.sharer === null ? ' is-on' : ''}`} onClick={() => state.setSharer(null)}>All</button>
              {state.scope.members.map((m) => (
                <button key={m.id} type="button" className={`ar-mono${state.sharer === m.id ? ' is-on' : ''}`} onClick={() => state.setSharer(m.id)}>
                  <span className="ar-stamp ar-stamp-sm">{m.initials}</span>{m.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {[...groups].map(([group, list]) => (
          <section key={group}>
            <p className="ar-mono ar-label">{team ? 'Filed by' : 'Folder'} / {group}</p>
            <ul>
              {list.map((s) => (
                <li key={s.id}>
                  <button type="button" className={`ar-nav-row${session?.id === s.id ? ' is-on' : ''}`} onClick={() => state.selectSession(s.id)}>
                    <span className="ar-mono">№ {pad(s.number)}</span>
                    <span className="ar-nav-title">{s.title}</span>
                    <span className="ar-mono ar-nav-date">{relativeDay(s.lastActivity)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {state.sessions.length === 0 && <p className="ar-empty">이 사람이 공유한 기록이 아직 없어요.</p>}
      </aside>

      <section className="ar-stage">
        {session ? <Orbit state={state} session={session} /> : <p className="ar-empty">기록이 없어요.</p>}
        {session && (
          <div className="ar-tray" aria-label="페이지">
            {session.pages.map((page, index) => (
              <button key={page.id} type="button" className={`ar-card${index === state.pageIndex ? ' is-on' : ''}`} onClick={() => state.setPageIndex(index)}>
                <span className="ar-mono ar-card-no">{pad(index + 1, 2)} / {pad(session.pages.length, 2)}</span>
                <span className="ar-card-title">{page.title}</span>
                <span className="ar-mono ar-card-domain"><img src={favicon(page.domain)} alt="" />{page.domain}</span>
                <span className="ar-card-bar"><i style={{ width: `${Math.min(100, (page.minutes / 12) * 100)}%` }} /></span>
              </button>
            ))}
          </div>
        )}
        <p className="ar-mono ar-hint">← → 페이지 · ↑ ↓ 기록</p>
      </section>

      {session && (
        <aside className="ar-specimen" aria-label="세부 정보">
          <p className="ar-mono ar-label">Specimen data</p>
          <h2 className="ar-title">{session.title}</h2>
          <SpecGrid session={session} />
          <p className="ar-mono ar-label">Summary</p>
          <p className="ar-body">{session.overview || '요약을 만드는 중이에요.'}</p>
          {session.highlights.length > 0 && (
            <>
              <p className="ar-mono ar-label">Notes</p>
              <ol className="ar-notes-list">
                {session.highlights.map((h, i) => <li key={h}><em>{pad(i + 1, 2)}</em>{h}</li>)}
              </ol>
            </>
          )}
          {[...session.todos, ...session.next].length > 0 && (
            <>
              <p className="ar-mono ar-label">Next</p>
              <ul className="ar-todo">
                {[...session.todos, ...session.next].map((t) => <li key={t}><label><input type="checkbox" />{t}</label></li>)}
              </ul>
            </>
          )}
          <div className="ar-actions">
            <button type="button" className="ar-pill">모든 페이지 열기 ↗</button>
            {!team && <button type="button" className="ar-link ar-mono">팀에 공유</button>}
          </div>
        </aside>
      )}
    </main>
  );
}

function App() {
  const state = useMockState();
  return (
    <div className="ar-root">
      <Masthead state={state} />
      {state.view === 'home' ? <Home state={state} /> : <Atlas state={state} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
