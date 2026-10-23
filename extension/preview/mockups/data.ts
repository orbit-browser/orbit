/**
 * 디자인 방향 시안이 함께 쓰는 데이터와 조작 상태. 미리보기의 합성 데이터(fixtures)를 화면용으로 펼친다.
 * 시안은 저장하지 않는다 — 새로고침하면 처음 상태로 돌아간다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPreviewDb, type PreviewDb, type PreviewSession } from '../fixtures';

export interface MockPage {
  id: string;
  title: string;
  url: string;
  domain: string;
  minutes: number;
  visitedAt: Date;
}

export interface MockPerson {
  id: string;
  name: string;
  initials: string;
  role?: 'owner' | 'member';
}

export interface MockSession {
  id: string;
  /** 아카이브 번호. 오래된 것부터 1. */
  number: number;
  title: string;
  overview: string;
  purpose: string;
  highlights: string[];
  todos: string[];
  next: string[];
  pending: boolean;
  lastActivity: Date;
  firstVisit: Date;
  pages: MockPage[];
  minutes: number;
  folder: { name: string; hue: string } | null;
  sharedBy: MockPerson | null;
}

export interface MockScope {
  id: string | null;
  name: string;
  role: 'owner' | 'member' | null;
  hue: string;
  members: MockPerson[];
}

const db: PreviewDb = createPreviewDb();

function person(userId: string, role?: 'owner' | 'member'): MockPerson {
  const user = db.users.find((u) => u.user_id === userId);
  const name = user?.name ?? '팀원';
  return { id: userId, name, initials: name.slice(1, 3) || name.slice(0, 1), role };
}

function toSession(session: PreviewSession, number: number, sharedBy: string | null): MockSession {
  const folder = db.folders.find((f) => f.folder_id === session.folder_id);
  const pages = session.events.map((event) => ({
    id: event.event_id,
    title: event.title,
    url: event.url,
    domain: event.domain,
    minutes: Math.round(event.active_duration_ms / 60_000),
    visitedAt: new Date(event.visited_at),
  }));
  return {
    id: session.session_id,
    number,
    title: session.alias ?? session.title,
    overview: session.summary.overview,
    purpose: session.summary.purpose,
    highlights: session.summary.highlights,
    todos: session.summary.todos,
    next: session.summary.next_actions,
    pending: session.summary_status === 'pending',
    lastActivity: new Date(session.last_activity_at),
    firstVisit: new Date(session.created_at),
    pages,
    minutes: pages.reduce((sum, page) => sum + page.minutes, 0),
    folder: folder ? { name: folder.name, hue: folder.hue } : null,
    sharedBy: sharedBy ? person(sharedBy) : null,
  };
}

// 번호는 전체 기록에서 오래된 순으로 매긴다(아카이브 등록 번호처럼 범위가 바뀌어도 같은 세션은 같은 번호).
const numbering = new Map(
  [...db.sessions].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((s, index) => [s.session_id, index + 1]),
);

export const ME = person(db.me);

export const SCOPES: MockScope[] = [
  { id: null, name: '개인 기록', role: null, hue: '#ef6f47', members: [ME] },
  ...db.workspaces
    .filter((w) => w.members.some((m) => m.user_id === db.me))
    .map((w) => ({
      id: w.workspace_id,
      name: w.name,
      role: w.members.find((m) => m.user_id === db.me)!.role,
      hue: w.hue,
      members: w.members.map((m) => person(m.user_id, m.role)),
    })),
];

export function sessionsFor(scopeId: string | null): MockSession[] {
  const byRecent = (a: MockSession, b: MockSession) => b.lastActivity.getTime() - a.lastActivity.getTime();
  if (!scopeId) {
    return db.sessions
      .filter((s) => s.owner === db.me)
      .map((s) => toSession(s, numbering.get(s.session_id) ?? 0, null))
      .sort(byRecent);
  }
  const workspace = db.workspaces.find((w) => w.workspace_id === scopeId);
  if (!workspace) return [];
  return workspace.shares
    .map((share) => {
      const session = db.sessions.find((s) => s.session_id === share.session_id);
      return session ? toSession(session, numbering.get(session.session_id) ?? 0, share.shared_by) : null;
    })
    .filter((s): s is MockSession => s !== null)
    .sort(byRecent);
}

export const RECOMMENDATIONS = (() => {
  const mine = sessionsFor(null).filter((s) => !s.pending);
  return [
    { session: mine[1], kind: '이어가기', reason: '어제 정리하다 멈춘 세션이에요. 남은 할 일이 1개 있어요.' },
    { session: mine[3], kind: '연관', reason: '방금 본 검색과 같은 주제의 기록이에요.' },
    { session: mine[mine.length - 2], kind: '다시 보기', reason: '일주일 전에 모아 둔 체크리스트를 다시 볼 때예요.' },
  ].filter((item) => item.session);
})();

export const SHORTCUTS = [
  { title: 'NAVER', domain: 'naver.com' },
  { title: 'YouTube', domain: 'youtube.com' },
  { title: 'GitHub', domain: 'github.com' },
  { title: 'Gmail', domain: 'mail.google.com' },
  { title: '다나와', domain: 'danawa.com' },
  { title: 'Notion', domain: 'notion.so' },
];

export function favicon(domain: string): string {
  return `/_favicon/?pageUrl=${encodeURIComponent(`https://${domain}/`)}&size=32`;
}

export function relativeDay(date: Date): string {
  const days = Math.floor((startOfDay(new Date()).getTime() - startOfDay(date).getTime()) / 86_400_000);
  if (days <= 0) return '오늘';
  if (days === 1) return '어제';
  if (days < 7) return `${days}일 전`;
  return `${Math.floor(days / 7)}주 전`;
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function clock(date: Date): string {
  return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function shortDate(date: Date): string {
  return `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
}

export function pad(value: number, size = 3): string {
  return String(value).padStart(size, '0');
}

export function duration(minutes: number): string {
  return minutes >= 60 ? `${Math.floor(minutes / 60)}시간 ${minutes % 60}분` : `${minutes}분`;
}

export function matches(session: MockSession, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [session.title, session.overview, ...session.pages.map((p) => p.title), ...session.pages.map((p) => p.domain)]
    .join(' ')
    .toLowerCase()
    .includes(q);
}

/** 화면(홈·아틀라스)·범위·선택 세션·선택 페이지. 화살표 ←→ 페이지, ↑↓ 세션. */
export function useMockState() {
  const params = new URLSearchParams(location.search);
  const [view, setView] = useState<'home' | 'atlas'>(params.get('view') === 'atlas' ? 'atlas' : 'home');
  const [scopeId, setScopeId] = useState<string | null>(params.get('scope') || null);
  const [sharer, setSharer] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const scope = SCOPES.find((s) => s.id === scopeId) ?? SCOPES[0];
  const all = useMemo(() => sessionsFor(scope.id), [scope.id]);
  const sessions = useMemo(() => (sharer ? all.filter((s) => s.sharedBy?.id === sharer) : all), [all, sharer]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const selected = sessions.find((s) => s.id === selectedId) ?? sessions[0] ?? null;

  const selectSession = useCallback((id: string) => {
    setSelectedId(id);
    setPageIndex(0);
  }, []);
  const changeScope = useCallback((id: string | null) => {
    setScopeId(id);
    setSharer(null);
    setSelectedId(null);
    setPageIndex(0);
  }, []);
  const openInAtlas = useCallback((id: string) => {
    selectSession(id);
    setView('atlas');
  }, [selectSession]);

  useEffect(() => {
    if (view !== 'atlas') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || !selected) return;
      if (event.key === 'ArrowRight') setPageIndex((i) => (i + 1) % selected.pages.length);
      else if (event.key === 'ArrowLeft') setPageIndex((i) => (i - 1 + selected.pages.length) % selected.pages.length);
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const index = sessions.findIndex((s) => s.id === selected.id);
        const next = sessions[(index + (event.key === 'ArrowDown' ? 1 : -1) + sessions.length) % sessions.length];
        if (next) selectSession(next.id);
      } else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, selected, sessions, selectSession]);

  return {
    view, setView, scope, changeScope, sharer, setSharer, query, setQuery,
    sessions, selected, selectSession, pageIndex: selected ? Math.min(pageIndex, selected.pages.length - 1) : 0,
    setPageIndex, openInAtlas,
  };
}

/** 원 위의 점 위치. 선택된 페이지가 아래(6시 방향)에 오도록 돌린다. */
export function orbitPoint(index: number, count: number, selected: number, radius: number, cx: number, cy: number) {
  const step = (Math.PI * 2) / Math.max(count, 1);
  const angle = Math.PI / 2 + (index - selected) * step;
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle), angle };
}

/** 페이지별 머문 시간으로 만든 잔잔한 파형(아카이브 행의 배경선). */
export function wavePath(minutes: number[], width: number, height: number, phase = 0): string {
  const total = minutes.reduce((a, b) => a + b, 0) || 1;
  const points: string[] = [];
  const steps = 96;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    let amp = 0;
    let acc = 0;
    minutes.forEach((m, k) => {
      const center = (acc + m / 2) / total;
      acc += m;
      amp += (m / total) * Math.exp(-((t - center) ** 2) / 0.004) * (1 + (k % 3) * 0.2);
    });
    const y = height / 2 + Math.sin(t * Math.PI * 6 + phase) * amp * height * 0.9;
    points.push(`${(t * width).toFixed(1)},${y.toFixed(1)}`);
  }
  return `M${points.join(' L')}`;
}
