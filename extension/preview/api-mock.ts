/**
 * 미리보기용 백엔드 대역. `fetch` 를 가로채 백엔드 API 와 같은 모양으로 답한다.
 *
 * 상태는 localStorage 한 곳에 둔다 — 새 탭과 사이드패널은 서로 다른 iframe 이라,
 * 한쪽에서 공유하면 다른 쪽이 다음 요청에서 바로 보게 하려면 저장소를 같이 써야 한다.
 * 권한 규칙은 백엔드의 것을 따른다(비멤버 404, owner 전용 403, owner 탈퇴 409, 팀원에게 폴더 숨김).
 */
import { createPreviewDb, type PreviewDb, type PreviewSession } from './fixtures';

export const API_BASE: string = import.meta.env.VITE_API_BASE_URL ?? 'http://orbit-preview.invalid';
const DB_KEY = 'orbit-preview:db';

export function loadDb(): PreviewDb {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return JSON.parse(raw) as PreviewDb;
  } catch {
    // 손상된 값은 새로 만든다.
  }
  const db = createPreviewDb();
  saveDb(db);
  return db;
}

function saveDb(db: PreviewDb): void {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

export function resetDb(): void {
  localStorage.removeItem(DB_KEY);
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const empty = () => new Response(null, { status: 204 });
const fail = (status: number, detail: string) => json({ detail }, status);

function byActivity(a: PreviewSession, b: PreviewSession): number {
  return b.last_activity_at.localeCompare(a.last_activity_at);
}

function memberOf(db: PreviewDb, workspaceId: string, userId = db.me) {
  return db.workspaces.find((w) => w.workspace_id === workspaceId)?.members.find((m) => m.user_id === userId);
}

/** 공유자가 아직 멤버인 공유만 센다(백엔드 `sharer_is_member`). */
function liveShares(db: PreviewDb, workspaceId: string) {
  const workspace = db.workspaces.find((w) => w.workspace_id === workspaceId);
  if (!workspace) return [];
  return workspace.shares.filter((s) => workspace.members.some((m) => m.user_id === s.shared_by));
}

function sharedWorkspaceIds(db: PreviewDb, sessionId: string): string[] {
  return db.workspaces
    .filter((w) => memberOf(db, w.workspace_id) && liveShares(db, w.workspace_id).some((s) => s.session_id === sessionId))
    .map((w) => w.workspace_id);
}

function toBackendSession(db: PreviewDb, session: PreviewSession, includePrivate: boolean) {
  return {
    session_id: session.session_id,
    title: session.alias ?? session.title,
    alias: session.alias,
    summary: session.summary,
    summary_status: session.summary_status,
    tabs: session.events.map((e) => ({ id: e.event_id, title: e.title, url: e.url, fav_icon_url: null })),
    created_at: session.created_at,
    updated_at: session.updated_at,
    last_activity_at: session.last_activity_at,
    folder_id: includePrivate ? session.folder_id : null,
    shared_workspace_ids: includePrivate ? sharedWorkspaceIds(db, session.session_id) : [],
  };
}

function readable(db: PreviewDb, sessionId: string): PreviewSession | undefined {
  const session = db.sessions.find((s) => s.session_id === sessionId);
  if (!session) return undefined;
  if (session.owner === db.me) return session;
  const shared = db.workspaces.some(
    (w) => memberOf(db, w.workspace_id) && liveShares(db, w.workspace_id).some((s) => s.session_id === sessionId),
  );
  return shared ? session : undefined;
}

/** 지금 범위에서 볼 수 있는 세션. workspaceId 가 없으면 내 세션이다. */
function scopeSessions(db: PreviewDb, workspaceId: string | null): PreviewSession[] {
  if (!workspaceId) return db.sessions.filter((s) => s.owner === db.me).sort(byActivity);
  const ids = new Set(liveShares(db, workspaceId).map((s) => s.session_id));
  return db.sessions.filter((s) => ids.has(s.session_id)).sort(byActivity);
}

function matches(session: PreviewSession, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const haystack = [session.alias ?? '', session.title, session.summary.overview, ...session.events.map((e) => e.title)]
    .join(' ')
    .toLowerCase();
  return q.split(/\s+/).some((word) => haystack.includes(word));
}

function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function workspaceItem(db: PreviewDb, workspaceId: string) {
  const workspace = db.workspaces.find((w) => w.workspace_id === workspaceId)!;
  return {
    workspace_id: workspace.workspace_id,
    name: workspace.name,
    hue: workspace.hue,
    role: memberOf(db, workspaceId)?.role ?? 'member',
    member_count: workspace.members.length,
    created_at: workspace.created_at,
  };
}

function sse(frames: { event: string; data: unknown; delayMs: number }[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const frame of frames) {
        await new Promise((resolve) => setTimeout(resolve, frame.delayMs));
        controller.enqueue(encoder.encode(`event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

async function readJson(init?: RequestInit): Promise<Record<string, unknown>> {
  if (typeof init?.body !== 'string') return {};
  try {
    return JSON.parse(init.body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function route(method: string, url: URL, init?: RequestInit): Promise<Response> {
  const db = loadDb();
  const path = url.pathname.replace(/\/+$/, '');
  const parts = path.split('/').filter(Boolean);
  const body = await readJson(init);
  const done = (response: Response) => {
    saveDb(db);
    return response;
  };

  if (path === '/health') return json({ status: 'ok' });
  if (path === '/settings') return json({ auto_merge_enabled: false });
  if (path === '/sync' || (path === '/events' && method === 'POST')) return json({ accepted: 0, duplicates: 0 });
  if (path === '/assistant/route') return json({ intent: 'search_memory', confidence: null, margin: null, reason: 'fallback' });
  if (path === '/tab-actions/resolve') {
    return json({ action: 'ask', reason: 'non_navigation', tab_id: null, score: null, margin: null, candidates: [] });
  }

  if (path === '/recommendations') {
    const mine = scopeSessions(db, null).filter((s) => s.summary_status === 'done');
    const pick = [
      [mine[1], 'continue', '어제 정리하다 멈춘 세션이에요. 남은 할 일이 1개 있어요.'],
      [mine[3], 'related', '방금 본 검색과 같은 주제의 기록이에요.'],
      [mine[mine.length - 2], 'rediscover', '일주일 전에 모아 둔 체크리스트를 다시 볼 때예요.'],
    ] as const;
    return json({
      items: pick.filter(([s]) => s).map(([s, kind, reason], index) => ({
        session_id: s!.session_id, title: s!.alias ?? s!.title, kind, reason, score: 0.9 - index * 0.1,
      })),
      computed_at: new Date().toISOString(),
      is_stale: false,
    });
  }

  if (path === '/analytics/overview') {
    const mine = scopeSessions(db, null);
    const domains = new Map<string, number>();
    mine.flatMap((s) => s.events).forEach((e) => domains.set(e.domain, (domains.get(e.domain) ?? 0) + 1));
    return json({
      period_days: Number(url.searchParams.get('days') ?? 7),
      top_sessions_by_duration: mine.slice(0, 5).map((s) => ({
        session_id: s.session_id, title: s.alias ?? s.title,
        total_active_duration_ms: s.events.reduce((sum, e) => sum + e.active_duration_ms, 0),
      })),
      top_domains: [...domains].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([domain, visit_count]) => ({ domain, visit_count })),
    });
  }

  if (path === '/events' && method === 'GET') {
    const date = url.searchParams.get('date') ?? '';
    const sameDay = (iso: string) => new Date(iso).toLocaleDateString('sv-SE') === date;
    return json(scopeSessions(db, null).flatMap((s) =>
      s.events.filter((e) => sameDay(e.visited_at)).map((e) => ({
        ...e, session_id: s.session_id, session_title: s.alias ?? s.title, excluded: false,
      })),
    ).sort((a, b) => b.visited_at.localeCompare(a.visited_at)));
  }
  if (parts[0] === 'events' && parts[1] && method === 'DELETE') return empty();

  if (path === '/search') {
    const q = url.searchParams.get('q') ?? '';
    const workspaceId = url.searchParams.get('workspace_id');
    if (workspaceId && !memberOf(db, workspaceId)) return fail(404, 'Workspace not found');
    const found = scopeSessions(db, workspaceId).filter((s) => matches(s, q));
    const sessions = found.map((s) => toBackendSession(db, s, !workspaceId));
    if (url.searchParams.get('scope') !== 'memory') return json(sessions);
    const events = found.flatMap((s) => s.events.filter((e) => matches({ ...s, events: [e], summary: { ...s.summary, overview: '' } }, q))
      .map((e) => ({ ...e, session_id: s.session_id, session_title: s.alias ?? s.title, matched_by: 'keyword' as const })));
    return json({ sessions, events: events.slice(0, 20) });
  }

  if (path === '/ask/stream') {
    const workspaceId = typeof body.workspace_id === 'string' ? body.workspace_id : null;
    if (workspaceId && !memberOf(db, workspaceId)) return fail(404, 'Workspace not found');
    const query = String(body.query ?? '');
    const scoped = scopeSessions(db, workspaceId);
    const sources = (scoped.filter((s) => matches(s, query)).length ? scoped.filter((s) => matches(s, query)) : scoped).slice(0, 2);
    const answer = sources.length
      ? `${sources.map((s) => `「${s.alias ?? s.title}」`).join('와 ')} 기록을 찾았어요. ${sources[0].summary.overview} `
        + (sources[0].summary.highlights[0] ? `특히 ${sources[0].summary.highlights[0]}.` : '')
      : '이 범위에서는 관련 기록을 찾지 못했어요.';
    const chunks = answer.match(/.{1,18}/gsu) ?? [answer];
    return sse([
      { event: 'sources', data: { sessions: sources.map((s) => toBackendSession(db, s, !workspaceId)) }, delayMs: 350 },
      ...chunks.map((text) => ({ event: 'delta', data: { text }, delayMs: 60 })),
      { event: 'done', data: { model: 'preview-mock' }, delayMs: 50 },
    ]);
  }

  if (parts[0] === 'sessions') {
    if (parts.length === 1 && method === 'GET') {
      return json(scopeSessions(db, null).map((s) => toBackendSession(db, s, true)));
    }
    if (parts[1] === 'merge-suggestions') return json([]);
    if (parts[1] === 'cluster' && method === 'POST') {
      const tabs = Array.isArray(body.tabs) ? (body.tabs as { title?: string; url?: string }[]) : [];
      const now = new Date().toISOString();
      const session: PreviewSession = {
        session_id: newId('s'), owner: db.me, title: '저장한 탭 묶음', alias: null,
        summary: { overview: '미리보기에서 저장한 탭 묶음이에요.', purpose: '', highlights: [], todos: [], next_actions: [] },
        summary_status: 'done', created_at: now, updated_at: now, last_activity_at: now, folder_id: null,
        events: tabs.map((t, index) => ({
          event_id: newId('e'), url: t.url ?? '', title: t.title ?? '', domain: t.url ? new URL(t.url).hostname : '',
          visited_at: new Date(Date.now() - (tabs.length - index) * 60_000).toISOString(), active_duration_ms: 60_000,
        })),
      };
      db.sessions.push(session);
      return done(json([toBackendSession(db, session, true)]));
    }
    const session = readable(db, parts[1]);
    if (!session) return fail(404, 'Session not found');
    const owner = session.owner === db.me;
    if (parts.length === 2 && method === 'GET') return json(toBackendSession(db, session, owner));
    if (parts[2] === 'events') {
      return json(session.events.map((e, index) => ({ ...e, relevance_score: null, sequence_order: index })));
    }
    if (!owner) return fail(404, 'Session not found');
    if (parts.length === 2 && method === 'PATCH') {
      const alias = typeof body.alias === 'string' && body.alias.trim() ? body.alias.trim() : null;
      session.alias = alias;
      session.updated_at = new Date().toISOString();
      return done(json(toBackendSession(db, session, true)));
    }
    if (parts.length === 2 && method === 'DELETE') {
      db.sessions = db.sessions.filter((s) => s.session_id !== session.session_id);
      db.workspaces.forEach((w) => { w.shares = w.shares.filter((s) => s.session_id !== session.session_id); });
      return done(empty());
    }
    if (parts[2] === 'retry-summary') {
      session.summary_status = 'done';
      return done(json(toBackendSession(db, session, true)));
    }
    if (parts[2] === 'merge' || parts[2] === 'unmerge') return empty();
  }

  if (parts[0] === 'folders') {
    const count = (folderId: string) => db.sessions.filter((s) => s.owner === db.me && s.folder_id === folderId).length;
    const item = (folderId: string) => {
      const f = db.folders.find((x) => x.folder_id === folderId)!;
      return { ...f, session_count: count(f.folder_id) };
    };
    if (parts.length === 1 && method === 'GET') {
      return json([...db.folders].sort((a, b) => a.position - b.position).map((f) => item(f.folder_id)));
    }
    if (parts.length === 1 && method === 'POST') {
      const now = new Date().toISOString();
      const position = db.folders.length;
      const folder = {
        folder_id: newId('f'), name: String(body.name ?? '새 폴더').slice(0, 60),
        hue: ['#ef6f47', '#e09528', '#7fa452', '#3aa09a', '#727bcb', '#c06aa2'][position % 6], position, created_at: now, updated_at: now,
      };
      db.folders.push(folder);
      return done(json(item(folder.folder_id), 201));
    }
    const folder = db.folders.find((f) => f.folder_id === parts[1]);
    if (!folder) return fail(404, 'Folder not found');
    if (parts.length === 2 && method === 'PATCH') {
      folder.name = String(body.name ?? folder.name).slice(0, 60);
      return done(json(item(folder.folder_id)));
    }
    if (parts.length === 2 && method === 'DELETE') {
      db.folders = db.folders.filter((f) => f.folder_id !== folder.folder_id);
      db.sessions.forEach((s) => { if (s.folder_id === folder.folder_id) s.folder_id = null; });
      return done(empty());
    }
    if (parts[2] === 'sessions' && parts.length === 3 && method === 'POST') {
      const ids = Array.isArray(body.session_ids) ? (body.session_ids as string[]) : [];
      const assigned: string[] = [];
      const skipped: string[] = [];
      ids.forEach((id) => {
        const s = db.sessions.find((x) => x.session_id === id && x.owner === db.me);
        if (s) { s.folder_id = folder.folder_id; assigned.push(id); } else skipped.push(id);
      });
      return done(json({ folder_id: folder.folder_id, assigned, skipped }));
    }
    if (parts[2] === 'sessions' && parts[3] && method === 'DELETE') {
      const s = db.sessions.find((x) => x.session_id === parts[3] && x.owner === db.me);
      if (s && s.folder_id === folder.folder_id) s.folder_id = null;
      return done(empty());
    }
  }

  if (parts[0] === 'workspaces') {
    if (parts.length === 1 && method === 'GET') {
      return json(db.workspaces.filter((w) => memberOf(db, w.workspace_id)).map((w) => workspaceItem(db, w.workspace_id)));
    }
    if (parts.length === 1 && method === 'POST') {
      const name = String(body.name ?? '').trim();
      if (!name) return fail(422, 'Name required');
      const now = new Date().toISOString();
      const workspace = {
        workspace_id: newId('w'), name: name.slice(0, 60), hue: ['#727bcb', '#3aa09a', '#c06aa2', '#e09528'][db.workspaces.length % 4],
        created_at: now, invite: null, members: [{ user_id: db.me, role: 'owner' as const, joined_at: now }], shares: [],
      };
      db.workspaces.push(workspace);
      return done(json(workspaceItem(db, workspace.workspace_id), 201));
    }
    if (parts[1] === 'join' && method === 'POST') {
      const code = String(body.code ?? '').trim();
      const workspace = db.workspaces.find((w) => w.invite?.code === code && Date.parse(w.invite.expires_at) > Date.now());
      if (!workspace) return fail(400, 'Invalid or expired invite code');
      if (!memberOf(db, workspace.workspace_id)) {
        workspace.members.push({ user_id: db.me, role: 'member', joined_at: new Date().toISOString() });
      }
      return done(json(workspaceItem(db, workspace.workspace_id)));
    }

    const workspace = db.workspaces.find((w) => w.workspace_id === parts[1]);
    const me = workspace ? memberOf(db, workspace.workspace_id) : undefined;
    if (!workspace || !me) return fail(404, 'Workspace not found');
    const ownerOnly = () => (me.role === 'owner' ? null : fail(403, 'Owner only'));

    if (parts.length === 2 && method === 'PATCH') {
      const denied = ownerOnly();
      if (denied) return denied;
      workspace.name = String(body.name ?? workspace.name).trim().slice(0, 60) || workspace.name;
      return done(json(workspaceItem(db, workspace.workspace_id)));
    }
    if (parts.length === 2 && method === 'DELETE') {
      const denied = ownerOnly();
      if (denied) return denied;
      db.workspaces = db.workspaces.filter((w) => w.workspace_id !== workspace.workspace_id);
      return done(empty());
    }
    if (parts[2] === 'invite-code' && method === 'POST') {
      const denied = ownerOnly();
      if (denied) return denied;
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
      const code = Array.from({ length: 16 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
      workspace.invite = { code, expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString() };
      return done(json(workspace.invite));
    }
    if (parts[2] === 'members' && parts.length === 3) {
      return json(workspace.members.map((m) => {
        const user = db.users.find((u) => u.user_id === m.user_id);
        return {
          user_id: m.user_id, name: user?.name ?? null, picture: user?.picture ?? null, role: m.role, joined_at: m.joined_at,
          email: me.role === 'owner' || m.user_id === db.me ? user?.email ?? null : null,
        };
      }));
    }
    if (parts[2] === 'members' && parts[3] && method === 'DELETE') {
      const target = parts[3];
      if (target === db.me && me.role === 'owner') return fail(409, 'Owner cannot leave');
      if (target !== db.me && me.role !== 'owner') return fail(403, 'Owner only');
      workspace.members = workspace.members.filter((m) => m.user_id !== target);
      workspace.shares = workspace.shares.filter((s) => s.shared_by !== target);
      if (target !== db.me) workspace.invite = null;
      return done(empty());
    }
    if (parts[2] === 'sessions' && parts.length === 3 && method === 'GET') {
      const shares = new Map(liveShares(db, workspace.workspace_id).map((s) => [s.session_id, s]));
      return json(scopeSessions(db, workspace.workspace_id).map((s) => {
        const share = shares.get(s.session_id)!;
        const user = db.users.find((u) => u.user_id === share.shared_by);
        return {
          ...toBackendSession(db, s, false),
          shared_by: { user_id: share.shared_by, name: user?.name ?? null, picture: user?.picture ?? null },
          shared_at: share.shared_at,
        };
      }));
    }
    if (parts[2] === 'sessions' && parts.length === 3 && method === 'POST') {
      const ids = Array.isArray(body.session_ids) ? (body.session_ids as string[]) : [];
      const shared: string[] = [];
      const skipped: string[] = [];
      ids.forEach((id) => {
        const s = db.sessions.find((x) => x.session_id === id && x.owner === db.me);
        if (!s) { skipped.push(id); return; }
        if (!workspace.shares.some((x) => x.session_id === id)) {
          workspace.shares.push({ session_id: id, shared_by: db.me, shared_at: new Date().toISOString() });
        }
        shared.push(id);
      });
      return done(json({ workspace_id: workspace.workspace_id, shared, skipped }));
    }
    if (parts[2] === 'sessions' && parts[3] && method === 'DELETE') {
      const share = workspace.shares.find((s) => s.session_id === parts[3]);
      if (!share) return fail(404, 'Share not found');
      if (share.shared_by !== db.me && me.role !== 'owner') return fail(403, 'Sharer or owner only');
      workspace.shares = workspace.shares.filter((s) => s !== share);
      return done(empty());
    }
  }

  console.warn('[preview] 대역이 없는 API', method, path);
  return fail(404, `No preview mock for ${method} ${path}`);
}

/** 백엔드 주소로 가는 요청만 가로챈다. 나머지(폰트·이미지)는 그대로 보낸다. */
export function installApiMock(): void {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!href.startsWith(API_BASE)) return realFetch(input, init);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    // 네트워크처럼 아주 짧게 기다려 로딩 상태도 한 번은 보이게 한다.
    await new Promise((resolve) => setTimeout(resolve, 120));
    return route(method, new URL(href), init);
  };
}
