/**
 * 방향 ③ 관측 장비 — 어두운 바탕, 빛나는 궤도와 흐름선, 장치 같은 패널과 모노 수치. 근거: Aura Identity,
 * PACT, 오디오 장치 카드, Chroma, Sinuous(변형 커뮤니티). 탐색 기록을 관측하는 계기판처럼 보여 준다.
 */
import { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import {
  SCOPES, clock, duration, favicon, matches, orbitPoint, pad, relativeDay, useMockState, type MockSession,
} from './data';
import './instrument.css';

type State = ReturnType<typeof useMockState>;

const MEMBER_COLORS = ['#ff8a4c', '#7ad7ff', '#c9a6ff', '#9be38f'];

/** 배경의 흐름선 — 고정 시드라 매번 같은 모양이다. */
function useFlowLines(count: number, width: number, height: number) {
  return useMemo(() => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    return Array.from({ length: count }, () => {
      let x = rand() * width;
      let y = rand() * height;
      const points = [`M${x.toFixed(1)},${y.toFixed(1)}`];
      for (let i = 0; i < 60; i += 1) {
        const angle = Math.sin(x * 0.004) * 2 + Math.cos(y * 0.005) * 2;
        x += Math.cos(angle) * 9;
        y += Math.sin(angle) * 9;
        points.push(`L${x.toFixed(1)},${y.toFixed(1)}`);
      }
      return points.join(' ');
    });
  }, [count, width, height]);
}

function Masthead({ state }: { state: State }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <header className="in-mast">
      <div className="in-mono in-brand"><span className="in-dot" />ORBIT / OBSERVATORY</div>
      <nav className="in-tabs" aria-label="화면">
        {(['home', 'atlas'] as const).map((view) => (
          <button key={view} type="button" className={`in-mono${state.view === view ? ' is-on' : ''}`} onClick={() => state.setView(view)}>
            {view === 'home' ? '01 · Home' : '02 · Atlas'}
          </button>
        ))}
      </nav>
      <div className="in-mast-right">
        <span className="in-mono">SYS · NOMINAL · {pad(state.sessions.length, 2)} SESSIONS · {now.toLocaleTimeString('en-GB')}</span>
        <select aria-label="보고 있는 기록" value={state.scope.id ?? ''} onChange={(event) => state.changeScope(event.target.value || null)}>
          {SCOPES.map((scope) => <option key={scope.id ?? 'me'} value={scope.id ?? ''}>{scope.name}</option>)}
        </select>
      </div>
    </header>
  );
}

function Sparkline({ session, height = 36 }: { session: MockSession; height?: number }) {
  const max = Math.max(...session.pages.map((p) => p.minutes), 1);
  const width = 200;
  const step = width / Math.max(session.pages.length - 1, 1);
  const d = session.pages.map((p, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${(height - (p.minutes / max) * (height - 6) - 3).toFixed(1)}`).join(' ');
  return (
    <svg className="in-spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function memberColor(state: State, session: MockSession): string {
  const index = state.scope.members.findIndex((m) => m.id === session.sharedBy?.id);
  return MEMBER_COLORS[Math.max(index, 0) % MEMBER_COLORS.length];
}

function Home({ state }: { state: State }) {
  const size = 760;
  const c = size / 2;
  const lines = useFlowLines(70, size, size);
  const visible = state.sessions.filter((s) => matches(s, state.query));
  const recent = visible.slice(0, 8);
  const team = state.scope.id !== null;
  return (
    <main className="in-home">
      <section className="in-observatory">
        <svg className="in-sky" viewBox={`0 0 ${size} ${size}`} aria-hidden>
          <defs>
            <filter id="glow"><feGaussianBlur stdDeviation="3.5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>
          {lines.map((d, i) => <path key={i} d={d} className="in-flow" />)}
          {[150, 215, 280, 345].map((r) => <circle key={r} cx={c} cy={c} r={r} className="in-orbit-ring" />)}
          {recent.map((session, index) => {
            // 가운데 검색창과 겹치지 않게 위·아래 호에만 둔다.
            const r = [215, 280, 345][index % 3];
            const half = Math.ceil(recent.length / 2);
            const slot = Math.floor(index / 2);
            const spread = (slot + 0.5) / half;
            const angle = index % 2 === 0 ? -Math.PI * (0.18 + spread * 0.64) : Math.PI * (0.18 + spread * 0.64);
            const x = c + Math.cos(angle) * r;
            const y = c + Math.sin(angle) * r;
            const color = team ? memberColor(state, session) : '#ff8a4c';
            return (
              <g key={session.id} className="in-sat" onClick={() => state.openInAtlas(session.id)} style={{ cursor: 'pointer' }}>
                <circle cx={x} cy={y} r={5 + session.pages.length} fill={color} opacity={0.18} />
                <circle cx={x} cy={y} r={4} fill={color} filter="url(#glow)" />
                <text x={x + 12} y={y + 4} className="in-sat-label">{session.title.length > 14 ? `${session.title.slice(0, 14)}…` : session.title}</text>
              </g>
            );
          })}
        </svg>
        <div className="in-command">
          <p className="in-mono">{team ? `Shared channel · ${state.scope.name}` : 'Personal channel'} · Query the archive</p>
          <label className="in-prompt">
            <span aria-hidden>&gt;</span>
            <input value={state.query} onChange={(event) => state.setQuery(event.target.value)} placeholder="무엇을 찾았었나요" aria-label="기록 검색" />
            <i className="in-caret" aria-hidden />
          </label>
          <p className="in-mono in-keys"><kbd>↵</kbd> 검색 <kbd>Tab</kbd> AI 질문 · {visible.length} signals</p>
        </div>
      </section>

      <section className="in-telemetry" aria-label="최근 탐색">
        {recent.slice(0, 4).map((session) => (
          <button key={session.id} type="button" className="in-card" onClick={() => state.openInAtlas(session.id)}>
            <span className="in-mono in-card-head">
              <span>SES-{pad(session.number)}</span>
              <span style={{ color: team ? memberColor(state, session) : undefined }}>● {relativeDay(session.lastActivity)}</span>
            </span>
            <b>{session.title}</b>
            <Sparkline session={session} />
            <span className="in-readout">
              <span><i className="in-mono">Pages</i>{pad(session.pages.length, 2)}</span>
              <span><i className="in-mono">Dwell</i>{session.minutes}′</span>
              <span><i className="in-mono">{session.sharedBy ? 'By' : 'Last'}</i>{session.sharedBy?.name ?? clock(session.lastActivity)}</span>
            </span>
          </button>
        ))}
        {recent.length === 0 && <p className="in-empty">이 검색어로 잡힌 신호가 없어요.</p>}
      </section>
    </main>
  );
}

function Atlas({ state }: { state: State }) {
  const session = state.selected;
  const team = state.scope.id !== null;
  const size = 640;
  const c = size / 2;
  const r = 230;
  const lines = useFlowLines(46, size, size);
  const page = session?.pages[state.pageIndex];
  const color = session && team ? memberColor(state, session) : '#ff8a4c';
  return (
    <main className="in-atlas">
      <aside className="in-panel in-list" aria-label="세션 목록">
        <p className="in-mono in-panel-title">Signals · {pad(state.sessions.length, 2)}</p>
        {team && (
          <div className="in-legend">
            <button type="button" className={`in-mono${state.sharer === null ? ' is-on' : ''}`} onClick={() => state.setSharer(null)}>ALL</button>
            {state.scope.members.map((m, i) => (
              <button key={m.id} type="button" className={`in-mono${state.sharer === m.id ? ' is-on' : ''}`} onClick={() => state.setSharer(m.id)}>
                <i style={{ background: MEMBER_COLORS[i % MEMBER_COLORS.length] }} />{m.name}
              </button>
            ))}
          </div>
        )}
        <ul>
          {state.sessions.map((s) => (
            <li key={s.id}>
              <button type="button" className={`in-row${session?.id === s.id ? ' is-on' : ''}`} onClick={() => state.selectSession(s.id)}>
                <i style={{ background: team ? memberColor(state, s) : '#ff8a4c' }} />
                <span className="in-row-title">{s.title}</span>
                <span className="in-mono">{pad(s.pages.length, 2)}P · {relativeDay(s.lastActivity)}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="in-stage">
        {session && (
          <div className="in-scope" style={{ ['--glow' as string]: color }}>
            <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${session.title} 궤도`}>
              <defs>
                <filter id="glow2"><feGaussianBlur stdDeviation="5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                <radialGradient id="core"><stop offset="0" stopColor={color} stopOpacity="0.45" /><stop offset="1" stopColor={color} stopOpacity="0" /></radialGradient>
              </defs>
              {lines.map((d, i) => <path key={i} d={d} className="in-flow" />)}
              <circle cx={c} cy={c} r={r * 0.62} fill="url(#core)" />
              <circle cx={c} cy={c} r={r} className="in-main-ring" filter="url(#glow2)" />
              <circle cx={c} cy={c} r={r + 26} className="in-orbit-ring" />
              <circle cx={c} cy={c} r={r - 26} className="in-orbit-ring" />
              {session.pages.map((p, index) => {
                const point = orbitPoint(index, session.pages.length, state.pageIndex, r, c, c);
                const on = index === state.pageIndex;
                return (
                  <g key={p.id} className={`in-node${on ? ' is-on' : ''}`} style={{ transform: `translate(${point.x}px, ${point.y}px)` }} onClick={() => state.setPageIndex(index)}>
                    <circle r={on ? 9 : 4.5} filter={on ? 'url(#glow2)' : undefined} />
                    <text x={14} y={4} className="in-node-label">{pad(index + 1, 2)}</text>
                  </g>
                );
              })}
            </svg>
            <div className="in-scope-center">
              <p className="in-mono">SES-{pad(session.number)} · {relativeDay(session.lastActivity)}</p>
              <h2>{session.title}</h2>
              <p className="in-mono">{session.pages.length} pages · {duration(session.minutes)}</p>
            </div>
            <div className="in-hud in-mono">
              <button type="button" onClick={() => state.setPageIndex((state.pageIndex - 1 + session.pages.length) % session.pages.length)}>◀</button>
              <span>{pad(state.pageIndex + 1, 2)} / {pad(session.pages.length, 2)}</span>
              <button type="button" onClick={() => state.setPageIndex((state.pageIndex + 1) % session.pages.length)}>▶</button>
            </div>
          </div>
        )}
        {session && (
          <div className="in-frames" aria-label="페이지">
            {session.pages.map((p, index) => (
              <button key={p.id} type="button" className={`in-frame${index === state.pageIndex ? ' is-on' : ''}`} onClick={() => state.setPageIndex(index)}>
                <span className="in-mono">F{pad(index + 1, 2)} · {p.minutes}′</span>
                <b>{p.title}</b>
                <span className="in-frame-domain"><img src={favicon(p.domain)} alt="" />{p.domain}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {session && (
        <aside className="in-panel in-readout-panel" aria-label="세부 정보">
          <p className="in-mono in-panel-title">Readout</p>
          <div className="in-device">
            <div className="in-meter">
              {Array.from({ length: 24 }, (_, i) => (
                <i key={i} style={{ height: `${20 + Math.abs(Math.sin(i * 1.3 + session.number)) * 80}%`, opacity: i / 24 < (page ? page.minutes / 12 : 0) ? 1 : 0.25 }} />
              ))}
            </div>
            <p className="in-mono">Current frame</p>
            <b>{page?.title}</b>
            <span className="in-mono">{page?.domain} · {page?.minutes}′ · {page ? clock(page.visitedAt) : ''}</span>
          </div>
          <dl className="in-stats">
            <div><dt className="in-mono">Pages</dt><dd>{pad(session.pages.length, 2)}</dd></div>
            <div><dt className="in-mono">Dwell</dt><dd>{session.minutes}′</dd></div>
            <div><dt className="in-mono">{session.sharedBy ? 'Source' : 'Folder'}</dt><dd className="in-small">{session.sharedBy?.name ?? session.folder?.name ?? '—'}</dd></div>
          </dl>
          <p className="in-mono in-panel-title">Summary</p>
          <p className="in-summary">{session.overview || '요약을 만드는 중이에요.'}</p>
          <ul className="in-points">
            {session.highlights.map((h) => <li key={h}>{h}</li>)}
          </ul>
          <div className="in-actions">
            <button type="button">모든 페이지 열기</button>
            {!team && <button type="button" className="in-ghost">팀에 공유</button>}
          </div>
        </aside>
      )}
    </main>
  );
}

function App() {
  const state = useMockState();
  return (
    <div className="in-root">
      <Masthead state={state} />
      {state.view === 'home' ? <Home state={state} /> : <Atlas state={state} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
