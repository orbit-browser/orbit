/**
 * 방향 ② 탐색 표본 — 굵은 숫자, 번호 단, 기울어진 종이 쪽지·티켓, 강조색 하나. 근거: Motion Specimen,
 * Post Post, Subscription Editions, Coastal Risk Models(변형 커뮤니티). 세션은 번호가 붙은 표본이고 페이지는 티켓이다.
 */
import { useState } from 'react';
import ReactDOM from 'react-dom/client';
import {
  RECOMMENDATIONS, SCOPES, SHORTCUTS, clock, duration, favicon, matches, orbitPoint, pad, relativeDay, shortDate,
  useMockState, type MockSession,
} from './data';
import './specimen.css';

type State = ReturnType<typeof useMockState>;

function Masthead({ state }: { state: State }) {
  return (
    <header className="sp-mast">
      <div className="sp-brand">
        <span className="sp-logo">ORBIT</span>
        <span className="sp-mono">Exploration specimen · Vol.10</span>
      </div>
      <nav className="sp-tabs" aria-label="화면">
        {(['home', 'atlas'] as const).map((view) => (
          <button key={view} type="button" className={state.view === view ? 'is-on' : ''} onClick={() => state.setView(view)}>
            {view === 'home' ? '홈' : '아틀라스'}
          </button>
        ))}
      </nav>
      <div className="sp-mast-right">
        <select aria-label="보고 있는 기록" value={state.scope.id ?? ''} onChange={(event) => state.changeScope(event.target.value || null)}>
          {SCOPES.map((scope) => <option key={scope.id ?? 'me'} value={scope.id ?? ''}>{scope.name}</option>)}
        </select>
        <span className="sp-avatar">김</span>
      </div>
    </header>
  );
}

/** 페이지 세 장을 겹쳐 놓은 쪽지 묶음. */
function SlipStack({ session }: { session: MockSession }) {
  return (
    <div className="sp-stack" aria-hidden>
      {session.pages.slice(0, 3).map((page, index) => (
        <span key={page.id} className="sp-slip" style={{ transform: `rotate(${[-6, 3, -1][index]}deg) translate(${index * 10}px, ${index * -4}px)` }}>
          <img src={favicon(page.domain)} alt="" />
          <i>{page.domain}</i>
        </span>
      ))}
    </div>
  );
}

function Ticket({ session, onOpen }: { session: MockSession; onOpen: () => void }) {
  const first = session.pages[0];
  const last = session.pages[session.pages.length - 1];
  return (
    <article className="sp-ticket">
      <div className="sp-ticket-main">
        <p className="sp-mono">Continue · No.{pad(session.number)}</p>
        <h2>{session.title}</h2>
        <p className="sp-ticket-overview">{session.overview}</p>
        <div className="sp-ticket-lines">
          <div><span className="sp-mono">Check-in</span><b>{first ? clock(first.visitedAt) : '—'}</b></div>
          <div><span className="sp-mono">Check-out</span><b>{last ? clock(last.visitedAt) : '—'}</b></div>
          <div><span className="sp-mono">Pages</span><b>{pad(session.pages.length, 2)}</b></div>
        </div>
      </div>
      <div className="sp-ticket-stub">
        <span className="sp-stamp">CONTINUE<br /><b>{relativeDay(session.lastActivity)}</b></span>
        <button type="button" onClick={onOpen}>이어서 열기 →</button>
      </div>
    </article>
  );
}

function Home({ state }: { state: State }) {
  const now = new Date();
  const team = state.scope.id !== null;
  const columns = state.sessions.filter((s) => matches(s, state.query)).slice(0, 6);
  const featured = state.sessions[0];
  return (
    <main className="sp-home">
      <section className="sp-hero">
        <div className="sp-date">
          <span className="sp-big">{String(now.getDate()).padStart(2, '0')}</span>
          <span className="sp-big sp-big-thin">.{String(now.getMonth() + 1).padStart(2, '0')}</span>
          <p className="sp-mono">{now.toLocaleDateString('en-GB', { weekday: 'long' }).toUpperCase()} · {team ? state.scope.name : '개인 기록'} · {pad(state.sessions.length, 2)} specimens</p>
        </div>
        <div className="sp-hero-right">
          <h1>오늘 무엇을<br />탐색했나요?</h1>
          <form className="sp-search" onSubmit={(event) => event.preventDefault()}>
            <input value={state.query} onChange={(event) => state.setQuery(event.target.value)} placeholder="검색어 또는 기억나는 목적" aria-label="기록 검색" />
            <button type="submit">검색</button>
            <button type="button" className="sp-outline">AI 질문</button>
          </form>
          <ul className="sp-shortcuts">
            {SHORTCUTS.map((s) => <li key={s.domain}><img src={favicon(s.domain)} alt="" />{s.title}</li>)}
          </ul>
        </div>
      </section>

      <section className="sp-columns" aria-label="최근 탐색">
        {columns.map((session, index) => (
          <button key={session.id} type="button" className="sp-col" onClick={() => state.openInAtlas(session.id)}>
            <span className="sp-col-no">{index + 1}</span>
            <span className="sp-mono sp-col-meta">{shortDate(session.lastActivity)} · {relativeDay(session.lastActivity)}</span>
            <span className="sp-col-title">{session.title}</span>
            <SlipStack session={session} />
            <span className="sp-mono sp-col-foot">
              {session.sharedBy ? <em className="sp-tag">{session.sharedBy.name}</em> : <em className="sp-tag sp-tag-ghost">{session.folder?.name ?? '미분류'}</em>}
              <span>{session.pages.length}P · {session.minutes}MIN</span>
            </span>
          </button>
        ))}
        {columns.length === 0 && <p className="sp-empty">이 검색어로 찾은 표본이 없어요.</p>}
      </section>

      <section className="sp-lower">
        {featured && <Ticket session={featured} onOpen={() => state.openInAtlas(featured.id)} />}
        {!team && (
          <div className="sp-receipts">
            <p className="sp-mono">Recommended · 지금 다시 볼 만한 표본</p>
            {RECOMMENDATIONS.map(({ session, kind, reason }) => (
              <button key={session.id} type="button" className="sp-receipt" onClick={() => state.openInAtlas(session.id)}>
                <span className="sp-mono">{kind} — No.{pad(session.number)}</span>
                <b>{session.title}</b>
                <span>{reason}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function Dial({ state, session }: { state: State; session: MockSession }) {
  const size = 520;
  const c = size / 2;
  const r = 200;
  const ticks = Array.from({ length: 60 }, (_, i) => i);
  return (
    <div className="sp-dial">
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${session.title} 페이지 다이얼`}>
        <circle cx={c} cy={c} r={r} className="sp-ring" />
        <circle cx={c} cy={c} r={r - 34} className="sp-ring-thin" />
        {ticks.map((i) => {
          const a = (i / 60) * Math.PI * 2;
          const long = i % 5 === 0;
          return <line key={i} x1={c + Math.cos(a) * (r + 8)} y1={c + Math.sin(a) * (r + 8)} x2={c + Math.cos(a) * (r + (long ? 22 : 14))} y2={c + Math.sin(a) * (r + (long ? 22 : 14))} className="sp-tick" />;
        })}
        {session.pages.map((page, index) => {
          const p = orbitPoint(index, session.pages.length, state.pageIndex, r, c, c);
          const on = index === state.pageIndex;
          return (
            <g key={page.id} className={`sp-node${on ? ' is-on' : ''}`} style={{ transform: `translate(${p.x}px, ${p.y}px)` }} onClick={() => state.setPageIndex(index)}>
              <rect x={-15} y={-15} width={30} height={30} rx={on ? 15 : 3} />
              <text y={5}>{pad(index + 1, 2)}</text>
            </g>
          );
        })}
        <polygon points={`${c - 9},${c + r + 30} ${c + 9},${c + r + 30} ${c},${c + r + 14}`} className="sp-pointer" />
      </svg>
      <div className="sp-dial-center">
        <span className="sp-dial-no">{pad(session.number)}</span>
        <h2>{session.title}</h2>
        <span className="sp-mono">{session.pages.length} pages · {duration(session.minutes)}</span>
      </div>
    </div>
  );
}

function Atlas({ state }: { state: State }) {
  const session = state.selected;
  const team = state.scope.id !== null;
  const [hover, setHover] = useState<number | null>(null);
  return (
    <main className="sp-atlas">
      <aside className="sp-list" aria-label="세션 목록">
        {team && (
          <div className="sp-filter">
            <button type="button" className={state.sharer === null ? 'is-on' : ''} onClick={() => state.setSharer(null)}>전체</button>
            {state.scope.members.map((m) => (
              <button key={m.id} type="button" className={state.sharer === m.id ? 'is-on' : ''} onClick={() => state.setSharer(m.id)}>{m.name}</button>
            ))}
          </div>
        )}
        <ol>
          {state.sessions.map((s, index) => (
            <li key={s.id}>
              <button type="button" className={`sp-strip${session?.id === s.id ? ' is-on' : ''}`} onClick={() => state.selectSession(s.id)}>
                <span className="sp-strip-no">{pad(index + 1, 2)}</span>
                <span className="sp-strip-body">
                  <b>{s.title}</b>
                  <span className="sp-mono">{relativeDay(s.lastActivity)} · {s.pages.length}P{s.sharedBy ? ` · ${s.sharedBy.name}` : ''}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </aside>

      <section className="sp-stage">
        {session && <Dial state={state} session={session} />}
        {session && (
          <div className="sp-fan" aria-label="페이지 티켓">
            {session.pages.map((page, index) => {
              const on = index === state.pageIndex;
              const tilt = on ? 0 : [-4, 3, -2, 4, -3, 2][index % 6];
              return (
                <button key={page.id} type="button" className={`sp-pticket${on ? ' is-on' : ''}`}
                  style={{ transform: `rotate(${hover === index && !on ? 0 : tilt}deg) translateY(${on ? -14 : hover === index ? -6 : 0}px)` }}
                  onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)} onClick={() => state.setPageIndex(index)}>
                  <span className="sp-mono">No.{pad(index + 1, 2)} · {page.minutes}min</span>
                  <b>{page.title}</b>
                  <span className="sp-pticket-domain"><img src={favicon(page.domain)} alt="" />{page.domain}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {session && (
        <aside className="sp-receipt-panel" aria-label="세부 정보">
          <p className="sp-mono">Specimen No.{pad(session.number)}</p>
          <h2>{session.title}</h2>
          {session.sharedBy && <span className="sp-stamp sp-stamp-sm">FILED BY<br /><b>{session.sharedBy.name}</b></span>}
          <div className="sp-dash" />
          <table className="sp-table">
            <tbody>
              {session.pages.map((page, index) => (
                <tr key={page.id} className={index === state.pageIndex ? 'is-on' : ''} onClick={() => state.setPageIndex(index)}>
                  <td>{pad(index + 1, 2)}</td>
                  <td>{page.domain}</td>
                  <td>{page.minutes}′</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="sp-dash" />
          <div className="sp-total"><span className="sp-mono">Total</span><b>{duration(session.minutes)}</b></div>
          <p className="sp-summary">{session.overview || '요약을 만드는 중이에요.'}</p>
          <ul className="sp-highlights">
            {session.highlights.map((h) => <li key={h}>{h}</li>)}
          </ul>
          <div className="sp-panel-actions">
            <button type="button">모든 페이지 열기</button>
            {!team && <button type="button" className="sp-outline">팀에 공유</button>}
          </div>
        </aside>
      )}
    </main>
  );
}

function App() {
  const state = useMockState();
  return (
    <div className="sp-root">
      <Masthead state={state} />
      {state.view === 'home' ? <Home state={state} /> : <Atlas state={state} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
