// 팀 수집 모드 확장 쪽 불변 조건 (docs/team-collect-mode.md §9.2).
// 서버는 fetch 대역이다. 기대값은 설계 문서에서 손으로 옮겼다.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { handlePageContentReady, initCollector } from '../../lib/events/collector';
import { addEvent, getEvent, listByStatus, setPendingChangeListener } from '../../lib/events/queue';
import { CONSENT_VERSION } from '../../lib/settings';
import { requestDrain } from '../../lib/sync/engine';
import { isTeamBlockedUrl } from '../../lib/sensitive-domains';
import {
  endTeamCollect,
  getActiveCollect,
  getCollectUi,
  handleAccountSwitch,
  handleBatchWindowClosed,
  handleBrowserStartup,
  handleWindowRemoved,
  reconcileWithWorkspaces,
  resumeDuration,
  retryTeamCollectRequests,
  startTeamCollect,
  teamLabelFor,
  TEAM_COLLECT_KEY,
  TEAM_COLLECT_RETRY_ALARM,
  withdrawTeamWindow,
  type ActiveCollect,
} from '../../lib/team-collect';
import type { Workspace } from '../../lib/types';
import { clearEvents, makeInput } from '../helpers';

const USER = 'user-b';
const TEAM = { id: 'ws-1', name: '리서치', hue: '#3aa09a' };
const TAB_ID = 11;

interface Call {
  method: string;
  path: string;
  auth: string | null;
  /** 요청이 나가는 순간의 로컬 창 상태 — "로컬 먼저 끄기" 순서를 본다. */
  localAtCall: unknown;
}

let calls: Call[] = [];
let failDelete = false;
let failWithdraw = false;
let failStart = false;
let workspacesBody: unknown[] = [];
let eventsWindowClosed = false;
let sentEvents: Record<string, unknown>[] = [];

function signIn(id = USER, token = 'token-b') {
  return chrome.storage.local.set({
    'orbit:auth': {
      token,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      user: { id, email: `${id}@example.com`, name: id, picture: null },
    },
    'orbit:collectionConsent': { [id]: CONSENT_VERSION },
    'orbit:settings': { collectionEnabled: true, contentCapture: true, excludeSensitive: true },
  });
}

async function seedActive(overrides: Partial<ActiveCollect> = {}, accountId = USER) {
  const active: ActiveCollect = {
    workspaceId: TEAM.id,
    workspaceName: TEAM.name,
    hue: TEAM.hue,
    windowId: 'cw-1',
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    clockOffsetMs: 0,
    ...overrides,
  };
  const stored = await chrome.storage.session.get(TEAM_COLLECT_KEY);
  await chrome.storage.session.set({
    [TEAM_COLLECT_KEY]: { ...(stored[TEAM_COLLECT_KEY] as object | undefined), [accountId]: active },
  });
  return active;
}

function installFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const local = (await chrome.storage.session.get(TEAM_COLLECT_KEY))[TEAM_COLLECT_KEY] ?? {};
      calls.push({
        method,
        path: url.pathname + url.search,
        auth: headers.Authorization ?? null,
        localAtCall: structuredClone(local),
      });
      if (url.pathname.endsWith('/collect') && method === 'DELETE') {
        return failDelete ? new Response('down', { status: 503 }) : new Response(null, { status: 204 });
      }
      if (url.pathname.endsWith('/collect') && method === 'POST') {
        if (failStart) return new Response('not allowed', { status: 409 });
        return Response.json(
          {
            window: {
              window_id: 'cw-new',
              workspace_id: TEAM.id,
              device_id: 'dev',
              started_at: '2026-10-23T00:00:00+00:00',
              expires_at: '2026-10-23T02:00:00+00:00',
            },
            server_now: '2026-10-23T00:00:00+00:00',
            ended_workspace_id: null,
          },
          { status: 201 },
        );
      }
      if (url.pathname.endsWith('/withdraw')) {
        if (failWithdraw) return new Response('down', { status: 503 });
        return Response.json({ withdrawn_events: 2, sessions: [], window_closed: true });
      }
      if (url.pathname === '/workspaces') return Response.json(workspacesBody);
      if (url.pathname === '/events') {
        sentEvents.push(...(JSON.parse(String(init?.body)).events as Record<string, unknown>[]));
        return Response.json({ accepted: 1, duplicates: 0, filtered: 0, pending_total: 1, window_closed: eventsWindowClosed });
      }
      if (url.pathname === '/settings') return Response.json({ team_collect_excluded_domains: ['corp.example'] });
      return Response.json({});
    }),
  );
}

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  fakeBrowser.reset();
  fakeBrowser.webNavigation.onCommitted.removeAllListeners();
  fakeBrowser.webNavigation.onHistoryStateUpdated.removeAllListeners();
  fakeBrowser.tabs.onUpdated.removeAllListeners();
  setPendingChangeListener(null);
  await clearEvents();
  calls = [];
  failDelete = false;
  failWithdraw = false;
  failStart = false;
  workspacesBody = [];
  eventsWindowClosed = false;
  sentEvents = [];
  installFetch();
});

describe('팀 수집 기본 제외 — 서버 is_team_blocked_url 과 같은 표', () => {
  // backend/tests/test_team_collect.py::test_team_blocked_urls 의 표를 그대로 옮겼다.
  it.each([
    ['https://www.gov.kr/mw/AA020InfoCappView.do', true],
    ['https://www.mois.go.kr/notice/1', false],
    ['https://shop.example.test/login', true],
    ['https://accounts.google.com/ServiceLogin', true],
    ['https://login.microsoftonline.com/common/oauth2', true],
    ['https://github.com/session', true],
    ['https://github.com/sessionize/app', false],
    ['https://mail.google.com/mail/u/0/', true],
    ['https://mail.naver.com/v2/folders/0', true],
    ['https://app.slack.com/client/T1/C1', true],
    ['https://discord.com/channels/1/2', true],
    ['https://discord.com/blog', false],
    ['https://www.instagram.com/direct/inbox/', true],
    ['https://www.google.com/search?q=private', true],
    ['https://www.google.com/search', true],
    ['https://search.naver.com/search.naver?query=x', true],
    ['https://www.youtube.com/results?search_query=x', true],
    ['https://www.youtube.com/watch?v=1', false],
    ['https://search.daum.net/search?w=tot&q=private', true],
    ['https://m.search.naver.com/search.naver?query=private', true],
    ['https://duckduckgo.com/?q=private', true],
    ['https://html.duckduckgo.com/html/?q=private', true],
    ['https://search.yahoo.com/search?p=private', true],
    ['https://www.ecosia.org/search?q=private', true],
    ['https://duckduckgo.com/about', false],
    ['https://www.daum.net/', false],
    ['not a url', true],
  ])('%s → %s', (url, blocked) => {
    expect(isTeamBlockedUrl(url)).toBe(blocked);
  });

  it('사용자 제외 목록은 호스트 접미사로 맞춘다', () => {
    expect(isTeamBlockedUrl('https://docs.corp.example/a', ['corp.example'])).toBe(true);
    expect(isTeamBlockedUrl('https://notcorp.example/a', ['corp.example'])).toBe(false);
  });
});

describe('방문 판정 teamLabelFor', () => {
  it('창이 없으면 개인', async () => {
    expect(await teamLabelFor(USER, 'https://example.com/a')).toBeNull();
  });

  it('창이 있으면 팀과 수집 창 id 를 싣는다', async () => {
    await seedActive();
    expect(await teamLabelFor(USER, 'https://example.com/a')).toEqual({ workspaceId: 'ws-1', collectWindowId: 'cw-1' });
  });

  it('다른 계정의 창은 쓰지 않는다', async () => {
    await seedActive({}, 'someone-else');
    expect(await teamLabelFor(USER, 'https://example.com/a')).toBeNull();
  });

  it('서버 시각으로 보정한 만료가 지나면 개인 — 기기 시계가 5분 늦어도', async () => {
    const now = Date.now();
    // 서버 시각 = 기기 시각 + 5분. 서버 기준으로는 1분 전에 끝났다.
    await seedActive({ expiresAt: new Date(now + 4 * 60_000).toISOString(), clockOffsetMs: 5 * 60_000 });
    expect(await teamLabelFor(USER, 'https://example.com/a', now)).toBeNull();
  });

  it('기본 제외·민감·사용자 제외는 개인', async () => {
    await seedActive();
    await chrome.storage.local.set({ 'orbit:teamCollectExcluded': { [USER]: ['corp.example'] } });
    expect(await teamLabelFor(USER, 'https://mail.google.com/mail/u/0/')).toBeNull();
    expect(await teamLabelFor(USER, 'https://www.hometax.go.kr/')).toBeNull();
    expect(await teamLabelFor(USER, 'https://wiki.corp.example/x')).toBeNull();
  });
});

describe('상태 저장과 켜기 (M1)', () => {
  it('시작한 창은 chrome.storage.session 에만 있고 local 에는 없다', async () => {
    await signIn();
    await startTeamCollect(TEAM, 120);
    const session = await chrome.storage.session.get(TEAM_COLLECT_KEY);
    const local = await chrome.storage.local.get(TEAM_COLLECT_KEY);
    expect((session[TEAM_COLLECT_KEY] as Record<string, ActiveCollect>)[USER].windowId).toBe('cw-new');
    expect(local[TEAM_COLLECT_KEY]).toBeUndefined();
    const start = calls.find((c) => c.method === 'POST' && c.path.endsWith('/collect'))!;
    expect(start.path).toBe('/workspaces/ws-1/collect');
  });

  it('시작이 실패하면 로컬 상태를 만들지 않는다', async () => {
    await signIn();
    failStart = true;
    await expect(startTeamCollect(TEAM, 120)).rejects.toThrow();
    expect(await getActiveCollect(USER)).toBeNull();
  });

  it('시작하면 사용자 제외 목록을 받아 둔다', async () => {
    await signIn();
    await startTeamCollect(TEAM, 60);
    expect(await teamLabelFor(USER, 'https://a.corp.example/')).toBeNull();
  });
});

describe('끄기는 로컬 먼저', () => {
  it('서버 DELETE 가 나가는 순간 로컬 창은 이미 없다', async () => {
    await signIn();
    await seedActive();
    await endTeamCollect(USER, 'stop');
    const del = calls.find((c) => c.method === 'DELETE')!;
    expect(del.path).toMatch(/^\/workspaces\/ws-1\/collect\?reason=stop&device_id=/);
    expect((del.localAtCall as Record<string, unknown>)[USER]).toBeUndefined();
  });

  it('서버 DELETE 가 실패해도 다음 방문은 개인이고, 재시도 알람이 걸린다', async () => {
    await signIn();
    await seedActive();
    failDelete = true;
    await endTeamCollect(USER, 'stop');
    expect(await teamLabelFor(USER, 'https://example.com/after')).toBeNull();
    expect(await chrome.alarms.get(TEAM_COLLECT_RETRY_ALARM)).toBeDefined();
    const stored = await chrome.storage.local.get('orbit:teamCollectRetry');
    expect(stored['orbit:teamCollectRetry']).toHaveLength(1);
  });

  it('재시도가 성공하면 목록에서 빠진다', async () => {
    await signIn();
    await seedActive();
    failDelete = true;
    await endTeamCollect(USER, 'stop');
    failDelete = false;
    await retryTeamCollectRequests();
    expect((await chrome.storage.local.get('orbit:teamCollectRetry'))['orbit:teamCollectRetry']).toEqual([]);
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(2);
  });

  it('끄면 돌아보기, 일시 정지면 남은 시간을 남긴다', async () => {
    await signIn();
    await seedActive({ windowId: 'cw-9' });
    await endTeamCollect(USER, 'stop');
    expect((await getCollectUi(USER)).ended?.windowId).toBe('cw-9');

    await seedActive({ expiresAt: new Date(Date.now() + 50 * 60_000).toISOString() });
    await endTeamCollect(USER, 'pause');
    const paused = (await getCollectUi(USER)).paused!;
    expect(paused.remainingMs).toBeGreaterThan(49 * 60_000);
    expect(calls.filter((c) => c.method === 'DELETE').at(-1)!.path).toContain('reason=pause');
  });

  it('다시 시작은 남은 시간 안의 가장 긴 길이, 최소 30분', () => {
    expect(resumeDuration(100 * 60_000)).toBe(60);
    expect(resumeDuration(10 * 60_000)).toBe(30);
    expect(resumeDuration(480 * 60_000)).toBe(480);
  });
});

describe('서버가 끝낸 창 (S\'5)', () => {
  it('window_closed 이고 배치의 팀 방문이 모두 지금 창이면 로컬을 끈다', async () => {
    await seedActive();
    expect(await handleBatchWindowClosed(USER, true, ['cw-1', null])).toBe(true);
    expect(await getActiveCollect(USER)).toBeNull();
    // 서버가 이미 끝냈으므로 DELETE 를 다시 보내지 않는다.
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  });

  it('team_downgraded 만 있는 응답(window_closed=false)에는 끄지 않는다', async () => {
    await seedActive();
    expect(await handleBatchWindowClosed(USER, false, ['cw-1'])).toBe(false);
    expect(await getActiveCollect(USER)).not.toBeNull();
  });

  it('이전 창(일시 정지 전)의 방문이 섞인 배치는 그 창 때문일 수 있어 끄지 않는다', async () => {
    await seedActive({ windowId: 'cw-2' });
    expect(await handleBatchWindowClosed(USER, true, ['cw-1', 'cw-2'])).toBe(false);
    expect(await handleBatchWindowClosed(USER, true, ['cw-1'])).toBe(false);
    expect(await getActiveCollect(USER)).not.toBeNull();
  });

  it('GET /workspaces 의 이 기기 창에 지금 창이 없으면 끈다', async () => {
    await seedActive();
    const listed = { id: 'ws-1', myCollect: { windowId: 'cw-1' } } as Workspace;
    expect(await reconcileWithWorkspaces(USER, [listed])).toBe(false);
    expect(await reconcileWithWorkspaces(USER, [{ ...listed, myCollect: null }])).toBe(true);
    expect(await getActiveCollect(USER)).toBeNull();
  });

  it('목록을 받는 사이 새로 시작한 창은 낡은 목록으로 끄지 않는다', async () => {
    await seedActive({ windowId: 'cw-new' });
    expect(await reconcileWithWorkspaces(USER, [], 'cw-old')).toBe(false);
    expect(await getActiveCollect(USER)).not.toBeNull();
  });
});

describe('브라우저 수명 (S\'4)', () => {
  it('마지막 일반 창이 닫히면 로컬부터 지우고 browser_restart 로 끝낸다', async () => {
    await signIn();
    await seedActive();
    vi.spyOn(chrome.windows, 'getAll').mockResolvedValue([] as never);
    await handleWindowRemoved();
    expect(await getActiveCollect(USER)).toBeNull();
    const del = calls.find((c) => c.method === 'DELETE')!;
    expect(del.path).toContain('reason=browser_restart');
    expect((del.localAtCall as Record<string, unknown>)[USER]).toBeUndefined();
  });

  it('창이 남아 있으면 그대로 둔다', async () => {
    await signIn();
    await seedActive();
    vi.spyOn(chrome.windows, 'getAll').mockResolvedValue([{ id: 1 }] as never);
    await handleWindowRemoved();
    expect(await getActiveCollect(USER)).not.toBeNull();
  });

  it('브라우저 시작 때 서버에 남은 이 기기의 창을 끝낸다', async () => {
    await signIn();
    workspacesBody = [
      {
        workspace_id: 'ws-1', name: '리서치', hue: '#3aa09a', role: 'member', member_count: 2,
        created_at: '2026-10-01T00:00:00Z', collect_allowed: true,
        my_collect: { window_id: 'cw-old', workspace_id: 'ws-1', device_id: 'd', started_at: 'x', expires_at: 'y' },
      },
      {
        workspace_id: 'ws-2', name: '다른 팀', hue: '#727bcb', role: 'member', member_count: 2,
        created_at: '2026-10-01T00:00:00Z', collect_allowed: true, my_collect: null,
      },
    ];
    await handleBrowserStartup();
    const deletes = calls.filter((c) => c.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(deletes[0].path).toMatch(/^\/workspaces\/ws-1\/collect\?reason=browser_restart&device_id=/);
  });
});

describe('계정 전환 (§6.5)', () => {
  it('이전 계정의 로컬 창을 먼저 지우고 이전 계정 토큰으로 끝낸다', async () => {
    await signIn('user-c', 'token-c');
    await seedActive({}, USER);
    await handleAccountSwitch({
      token: 'token-b',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      user: { id: USER, email: 'b@example.com', name: 'b', picture: null },
    });
    expect(await getActiveCollect(USER)).toBeNull();
    const del = calls.find((c) => c.method === 'DELETE')!;
    expect(del.auth).toBe('Bearer token-b');
    expect(del.path).toContain('reason=account_switch');
    expect((del.localAtCall as Record<string, unknown>)[USER]).toBeUndefined();
  });
});

describe('돌아보기 — 남은 방문도 모두 빼기', () => {
  it('로컬 큐의 그 창 방문을 개인으로 돌리고 서버 withdraw 를 부른다', async () => {
    await signIn();
    const mine = await addEvent(makeInput({ accountId: USER, workspaceId: 'ws-1', collectWindowId: 'cw-1' }));
    const other = await addEvent(makeInput({ accountId: USER, workspaceId: 'ws-1', collectWindowId: 'cw-2' }));
    const result = await withdrawTeamWindow(USER, 'ws-1', 'cw-1');
    expect(result.withdrawnEvents).toBe(2);
    expect((await getEvent(mine.eventId))!.workspaceId).toBeNull();
    expect((await getEvent(mine.eventId))!.collectWindowId).toBeNull();
    expect((await getEvent(other.eventId))!.collectWindowId).toBe('cw-2');
    expect(calls.some((c) => c.path === '/workspaces/ws-1/collect/windows/cw-1/withdraw')).toBe(true);
  });

  it('서버 withdraw 가 실패하면 재시도 목록에 넣고 "아직 빼는 중"으로 남긴다', async () => {
    await signIn();
    failWithdraw = true;
    await expect(withdrawTeamWindow(USER, 'ws-1', 'cw-1')).rejects.toThrow();
    expect((await getCollectUi(USER)).withdrawPending).toEqual(['cw-1']);
    failWithdraw = false;
    await retryTeamCollectRequests();
    expect((await getCollectUi(USER)).withdrawPending).toEqual([]);
  });

  it('열린 창을 빼면 로컬 창도 끈다(서버도 함께 끝낸다)', async () => {
    await signIn();
    await seedActive();
    await withdrawTeamWindow(USER, 'ws-1', 'cw-1');
    expect(await getActiveCollect(USER)).toBeNull();
  });
});

// ── 수집기 ──────────────────────────────────────────────────────────

function tab(url: string, title = 'Page', incognito = false): chrome.tabs.Tab {
  return {
    id: TAB_ID, windowId: 2, index: 0, active: false, highlighted: false, pinned: false,
    incognito, url, title, selected: false, discarded: false, autoDiscardable: true, groupId: -1, frozen: false,
  } as chrome.tabs.Tab;
}

function navDetails(url: string, transitionQualifiers: string[] = []) {
  return {
    frameId: 0, tabId: TAB_ID, url, transitionQualifiers, transitionType: 'link', processId: 1,
    timeStamp: Date.now(), documentId: 'doc', documentLifecycle: 'active',
    frameType: 'outermost_frame', parentFrameId: -1,
  } as never;
}

async function startCollector() {
  await signIn();
  const idle = { setDetectionInterval: () => {}, onStateChanged: { addListener: () => {} } };
  vi.spyOn(fakeBrowser, 'idle', 'get').mockReturnValue(idle as never);
  initCollector();
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

async function allEvents() {
  return [...(await listByStatus('open')), ...(await listByStatus('pending'))];
}

describe('수집기 — 팀 표시', () => {
  it('활성 창이 있으면 방문에 workspaceId·collectWindowId 를 싣고 제목은 비운다(S5)', async () => {
    await startCollector();
    await seedActive();
    vi.spyOn(chrome.tabs, 'get').mockResolvedValue(tab('https://example.com/a', '직전 페이지 제목') as never);
    await fakeBrowser.webNavigation.onCommitted.trigger(navDetails('https://example.com/a'));
    await settle();
    const [event] = await allEvents();
    expect(event.workspaceId).toBe('ws-1');
    expect(event.collectWindowId).toBe('cw-1');
    expect(event.title).toBe('');
  });

  it('창이 없으면 개인이고 제목은 그대로', async () => {
    await startCollector();
    vi.spyOn(chrome.tabs, 'get').mockResolvedValue(tab('https://example.com/a', 'A') as never);
    await fakeBrowser.webNavigation.onCommitted.trigger(navDetails('https://example.com/a'));
    await settle();
    const [event] = await allEvents();
    expect(event.workspaceId).toBeNull();
    expect(event.title).toBe('A');
  });

  it('기본 제외 주소는 개인으로만 남는다', async () => {
    await startCollector();
    await seedActive();
    vi.spyOn(chrome.tabs, 'get').mockResolvedValue(tab('https://mail.google.com/mail/u/0/') as never);
    await fakeBrowser.webNavigation.onCommitted.trigger(navDetails('https://mail.google.com/mail/u/0/'));
    await settle();
    const [event] = await allEvents();
    expect(event.workspaceId).toBeNull();
    expect(event.collectWindowId).toBeNull();
  });

  it('시크릿 탭은 팀으로도 개인으로도 남기지 않는다', async () => {
    await startCollector();
    await seedActive();
    vi.spyOn(chrome.tabs, 'get').mockResolvedValue(tab('https://example.com/s', 'S', true) as never);
    await fakeBrowser.webNavigation.onCommitted.trigger(navDetails('https://example.com/s'));
    await settle();
    expect(await allEvents()).toHaveLength(0);
  });

  it('리다이렉트로 로그인 화면으로 가면 팀 표시를 지운다', async () => {
    await startCollector();
    await seedActive();
    vi.spyOn(chrome.tabs, 'get').mockResolvedValue(tab('https://app.example.com/doc') as never);
    await fakeBrowser.webNavigation.onCommitted.trigger(navDetails('https://app.example.com/doc'));
    await settle();
    vi.spyOn(chrome.tabs, 'get').mockResolvedValue(tab('https://accounts.google.com/signin') as never);
    await fakeBrowser.webNavigation.onCommitted.trigger(
      navDetails('https://accounts.google.com/signin', ['server_redirect']),
    );
    await settle();
    const events = await allEvents();
    expect(events).toHaveLength(1);
    expect(events[0].url).toBe('https://accounts.google.com/signin');
    expect(events[0].workspaceId).toBeNull();
    expect(events[0].collectWindowId).toBeNull();
  });

  it('리다이렉트가 일반 주소로 가면 팀 표시를 유지한다', async () => {
    await startCollector();
    await seedActive();
    vi.spyOn(chrome.tabs, 'get').mockResolvedValue(tab('http://example.com/') as never);
    await fakeBrowser.webNavigation.onCommitted.trigger(navDetails('http://example.com/'));
    await settle();
    await fakeBrowser.webNavigation.onCommitted.trigger(navDetails('https://example.com/', ['server_redirect']));
    await settle();
    const [event] = await allEvents();
    expect(event.collectWindowId).toBe('cw-1');
  });

  it('본문을 붙일 때 탭 주소가 같으면 제목을 채우고, 다르면 비워 둔다', async () => {
    await startCollector();
    await seedActive();
    vi.spyOn(chrome.tabs, 'get').mockResolvedValue(tab('https://example.com/a', 'old') as never);
    await fakeBrowser.webNavigation.onCommitted.trigger(navDetails('https://example.com/a'));
    await settle();

    vi.spyOn(chrome.tabs, 'get').mockResolvedValue(tab('https://example.com/other', '다른 페이지') as never);
    await handlePageContentReady(TAB_ID, { textContent: 'body' } as never);
    expect((await allEvents())[0].title).toBe('');

    vi.spyOn(chrome.tabs, 'get').mockResolvedValue(tab('https://example.com/a', '진짜 제목') as never);
    await handlePageContentReady(TAB_ID, { textContent: 'body' } as never);
    expect((await allEvents())[0].title).toBe('진짜 제목');
  });

  it('팀 방문의 제목 변경도 주소가 같을 때만 반영한다', async () => {
    await startCollector();
    await seedActive();
    vi.spyOn(chrome.tabs, 'get').mockResolvedValue(tab('https://example.com/a', 'old') as never);
    await fakeBrowser.webNavigation.onCommitted.trigger(navDetails('https://example.com/a'));
    await settle();
    await fakeBrowser.tabs.onUpdated.trigger(TAB_ID, { title: '이전 주소 제목' }, tab('https://example.com/b'));
    await settle();
    expect((await allEvents())[0].title).toBe('');
    await fakeBrowser.tabs.onUpdated.trigger(TAB_ID, { title: 'A 제목' }, tab('https://example.com/a'));
    await settle();
    expect((await allEvents())[0].title).toBe('A 제목');
  });

  it('끈 뒤의 방문은 개인이다', async () => {
    await startCollector();
    await seedActive();
    failDelete = true;
    await endTeamCollect(USER, 'stop');
    vi.spyOn(chrome.tabs, 'get').mockResolvedValue(tab('https://example.com/later') as never);
    await fakeBrowser.webNavigation.onCommitted.trigger(navDetails('https://example.com/later'));
    await settle();
    expect((await allEvents())[0].workspaceId).toBeNull();
  });
});

describe('동기화 — 서버 응답 window_closed', () => {
  async function seedPendingTeamEvent() {
    const event = await addEvent(makeInput({ accountId: USER, workspaceId: 'ws-1', collectWindowId: 'cw-1' }));
    const { finalizeOpenEvent } = await import('../../lib/events/queue');
    await finalizeOpenEvent(event.eventId, new Date().toISOString());
  }

  it('팀 방문을 workspace_id·collect_window_id 로 보내고, window_closed 를 받으면 로컬을 끈다', async () => {
    await signIn();
    await seedActive();
    await seedPendingTeamEvent();
    eventsWindowClosed = true;
    requestDrain('threshold');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sentEvents[0]).toMatchObject({ workspace_id: 'ws-1', collect_window_id: 'cw-1' });
    expect(await getActiveCollect(USER)).toBeNull();
  });

  it('window_closed 가 없으면 로컬을 유지한다', async () => {
    await signIn();
    await seedActive();
    await seedPendingTeamEvent();
    requestDrain('threshold');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sentEvents).toHaveLength(1);
    expect(await getActiveCollect(USER)).not.toBeNull();
  });
});
