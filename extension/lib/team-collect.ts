// 팀 수집 모드의 확장 쪽 상태와 끄기 순서 (docs/team-collect-mode.md §1.3, §5.1, §6.5).
//
// 원칙
// - 수집 창 상태는 chrome.storage.session 에만 둔다. 브라우저를 다시 열면 Chrome 이 지우므로 서버 DELETE 가
//   실패해도(오프라인·토큰 만료) 재시작 뒤 방문에는 팀 표시가 붙지 않는다(M1).
// - 끌 때는 로컬을 먼저 지우고 그다음 서버 DELETE 를 보낸다. 실패하면 재시도 알람으로 다시 보낸다.
// - 팀 판정의 근거는 서버다. 여기 표시는 요청일 뿐이고, 애매하면 개인으로 둔다.

import {
  ApiError,
  fetchTeamCollectExcluded,
  fetchWorkspaces,
  startCollect,
  stopCollect,
  withdrawWindow,
  type CollectStopReason,
} from './api';
import { getSession, type AuthSession } from './auth';
import { hasCollectionConsent } from './settings';
import { getDeviceId } from './device-id';
import { clearTeamLabels } from './events/queue';
import { isTeamBlockedUrl } from './sensitive-domains';
import type { Workspace, WithdrawResult } from './types';

/** 팀 수집 동의 문구 버전. `TEAM_COLLECT_DISCLOSURE`·기본 제외 목록·AI 제공자가 바뀌면 올린다. */
export const TEAM_COLLECT_CONSENT_VERSION = 'team-2026-10-23';

/**
 * 팀 수집 동의 문구(설계 §7.1). 실제 노출보다 좁게 읽히면 안 된다 — 되돌릴 수 없음, 끈 뒤에도 남음,
 * 나중에 들어온 팀원도 봄, 제목·요약 속 검색어, 민감 사이트의 실제 범위, 로그인 화면은 "주소로 보이는 것"만.
 * AI 제공자는 `AI_DISCLOSURE` 와 같게 둔다(KT 믿:음 포함).
 */
export const TEAM_COLLECT_DISCLOSURE =
  '팀 수집을 켜 둔 동안 이 기기에서 연 페이지는 세션으로 묶여 지금과 나중에 들어올 팀원 모두에게 보여요. 팀원은 세션 이름·요약·페이지 제목·주소(쿼리 제외)·방문 시각과 내 이름을 보고, 제목과 요약에는 검색어가 남을 수 있어요. 수집을 꺼도 켜 둔 동안 모인 세션은 내가 빼기 전까지 팀에 남고, 팀원이 이미 본 것은 되돌릴 수 없어요. 팀 Ask는 본문 일부를 AI 서비스(Upstage·SKT A.X·LG EXAONE·KT 믿:음)로 보내요. 은행·증권·카드·결제·일부 공공·건강보험 사이트, 로그인·결제 주소로 보이는 페이지, 웹메일·메신저·검색 결과 페이지, 내가 뺀 사이트는 팀으로 보내지 않아요. 그 밖의 사이트는 제외 목록에 직접 넣어야 해요. 시크릿 창은 기록하지 않아요.';

/** 꺼지는 조건(설계 §7.2, S'4). */
export const TEAM_COLLECT_STOP_CONDITIONS =
  '정한 시간이 지나거나, Chrome 창을 모두 닫거나 Chrome을 끝내면 꺼져요. 일시 정지·끄기는 띠와 칩에서 할 수 있어요.';

export const COLLECT_DURATIONS = [30, 60, 120, 240, 480] as const;
export type CollectDuration = (typeof COLLECT_DURATIONS)[number];
export const DEFAULT_COLLECT_DURATION: CollectDuration = 120;
/** 만료 몇 분 전에 "곧 꺼져요 · 연장"을 보일지. */
export const EXPIRY_WARNING_MS = 10 * 60_000;

/** 계정별 활성 창(설계 §5.1의 `orbit:teamCollect`). */
export const TEAM_COLLECT_KEY = 'orbit:teamCollect';
/** 계정별 화면 상태 — 일시 정지·끝난 창 돌아보기. 활성 창과 따로 둬 판정 경로가 읽지 않게 한다. */
export const TEAM_COLLECT_UI_KEY = 'orbit:teamCollectUi';
/** 계정별 사용자 제외 목록 사본(서버 `team_collect_excluded_domains`). */
const EXCLUDED_KEY = 'orbit:teamCollectExcluded';
/** 계정별 팀 동의 기록: { [accountId]: { [workspaceId]: version } }. 처음만 긴 동의 화면을 보인다. */
const CONSENT_KEY = 'orbit:teamCollectConsent';
/** 실패한 서버 요청(끄기·빼기) 재시도 목록. 서버 정리용이라 브라우저를 다시 열어도 남긴다. */
const RETRY_KEY = 'orbit:teamCollectRetry';
export const TEAM_COLLECT_RETRY_ALARM = 'orbit-team-collect-retry';
export const TEAM_COLLECT_TICK_ALARM = 'orbit-team-collect-tick';

export interface ActiveCollect {
  workspaceId: string;
  workspaceName: string;
  hue: string;
  windowId: string;
  /** ISO 8601 (서버 시각) */
  startedAt: string;
  /** ISO 8601 (서버 시각) */
  expiresAt: string;
  /** 서버 시각 − 기기 시각(ms). 로컬 만료 판단에만 쓴다. */
  clockOffsetMs: number;
}

export interface PausedCollect {
  workspaceId: string;
  workspaceName: string;
  hue: string;
  remainingMs: number;
}

export interface EndedCollect {
  workspaceId: string;
  workspaceName: string;
  windowId: string;
  /** ISO 8601 */
  endedAt: string;
}

export interface CollectUiState {
  paused?: PausedCollect | null;
  /** 끝난 창 돌아보기. 사용자가 확인하면 지운다. */
  ended?: EndedCollect | null;
  /** 서버 빼기가 아직 성공하지 못한 창 id(돌아보기의 "아직 빼는 중"). */
  withdrawPending?: string[];
}

type RetryItem =
  | {
      kind: 'stop';
      accountId: string;
      workspaceId: string;
      deviceId: string | null;
      reason: CollectStopReason;
      /** 끄려는 창. 이 값이 없던 때 큐에 들어간 항목은 로컬 창이 있기만 하면 건너뛴다. */
      windowId?: string;
    }
  | { kind: 'withdraw'; accountId: string; workspaceId: string; windowId: string };

export interface TeamLabel {
  workspaceId: string;
  collectWindowId: string;
}

// ── 저장소 ─────────────────────────────────────────────────────────

async function readMap<T>(area: chrome.storage.StorageArea, key: string): Promise<Record<string, T>> {
  const stored = await area.get(key);
  return (stored[key] as Record<string, T> | undefined) ?? {};
}

/**
 * 서버 창을 여닫는 요청(시작·재시도·브라우저 시작 정리)을 컨텍스트(SW·새 탭·사이드패널) 사이에서 줄 세운다.
 * 낡은 끄기 재시도나 시작 정리가 방금 연 새 창을 닫지 않게 하려는 것이다(보안 검토 S1).
 */
const SERVER_LOCK = 'orbit-team-collect-server';
function withServerLock<T>(task: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) return task();
  return navigator.locks.request(SERVER_LOCK, task) as Promise<T>;
}

// 같은 컨텍스트 안의 read-modify-write 를 줄 세운다(시작과 끄기가 겹쳐 서로 덮어쓰지 않게).
let writeChain: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const next = writeChain.then(task);
  writeChain = next.catch(() => {});
  return next;
}

async function patchMap<T>(
  area: chrome.storage.StorageArea,
  key: string,
  accountId: string,
  update: (current: T | undefined) => T | undefined,
): Promise<void> {
  const map = await readMap<T>(area, key);
  const next = update(map[accountId]);
  if (next === undefined) delete map[accountId];
  else map[accountId] = next;
  await area.set({ [key]: map });
}

export async function getActiveCollect(accountId: string): Promise<ActiveCollect | null> {
  return (await readMap<ActiveCollect>(chrome.storage.session, TEAM_COLLECT_KEY))[accountId] ?? null;
}

export async function getCollectUi(accountId: string): Promise<CollectUiState> {
  return (await readMap<CollectUiState>(chrome.storage.session, TEAM_COLLECT_UI_KEY))[accountId] ?? {};
}

function patchUi(accountId: string, patch: Partial<CollectUiState>): Promise<void> {
  return patchMap<CollectUiState>(chrome.storage.session, TEAM_COLLECT_UI_KEY, accountId, (current) => ({
    ...current,
    ...patch,
  }));
}

/** 서버 시각으로 보정한 남은 시간(ms). 0 이하면 끝났다. */
export function remainingMs(active: Pick<ActiveCollect, 'expiresAt' | 'clockOffsetMs'>, nowMs = Date.now()): number {
  return new Date(active.expiresAt).getTime() - (nowMs + active.clockOffsetMs);
}

// ── 방문 판정 (설계 §2.1 3~5번) ─────────────────────────────────────

/** 주소·호스트 입력을 서버가 받는 호스트 접미사로 줄인다. 판정할 수 없으면 null. */
export function normalizeExcludedDomain(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  try {
    const host = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname.replace(/^\.+|\.+$/g, '');
    return host.includes('.') ? host : null;
  } catch {
    return null;
  }
}

export async function getExcludedDomains(accountId: string): Promise<string[]> {
  return (await readMap<string[]>(chrome.storage.local, EXCLUDED_KEY))[accountId] ?? [];
}

export async function setExcludedDomains(accountId: string, domains: string[]): Promise<void> {
  await patchMap<string[]>(chrome.storage.local, EXCLUDED_KEY, accountId, () => domains);
}

/**
 * 이 방문을 팀으로 보낼지. 활성 창이 없거나 만료됐거나 막힌 주소면 null(개인).
 * 개인 수집 동의·시크릿 창은 수집기가 먼저 거른다(§2.1 1·2번).
 */
export async function teamLabelFor(accountId: string, url: string, nowMs = Date.now()): Promise<TeamLabel | null> {
  const active = await getActiveCollect(accountId);
  if (!active || remainingMs(active, nowMs) <= 0) return null;
  if (isTeamBlockedUrl(url, await getExcludedDomains(accountId))) return null;
  return { workspaceId: active.workspaceId, collectWindowId: active.windowId };
}

// ── 동의 ───────────────────────────────────────────────────────────

export async function hasTeamConsent(accountId: string, workspaceId: string): Promise<boolean> {
  const map = await readMap<Record<string, string>>(chrome.storage.local, CONSENT_KEY);
  return map[accountId]?.[workspaceId] === TEAM_COLLECT_CONSENT_VERSION;
}

async function recordTeamConsent(accountId: string, workspaceId: string): Promise<void> {
  await patchMap<Record<string, string>>(chrome.storage.local, CONSENT_KEY, accountId, (current) => ({
    ...current,
    [workspaceId]: TEAM_COLLECT_CONSENT_VERSION,
  }));
}

// ── 켜기 ───────────────────────────────────────────────────────────

/**
 * 서버 창을 연 뒤에만 로컬 상태를 만든다 — 시작이 실패하면 창 없이 팀 표시를 붙이지 않는다(§8.1).
 * 같은 기기의 다른 팀 창은 서버가 같은 트랜잭션에서 끝낸다(`endedWorkspaceId`).
 */
export async function startTeamCollect(
  workspace: Pick<Workspace, 'id' | 'name' | 'hue'>,
  durationMinutes: CollectDuration,
): Promise<ActiveCollect> {
  const session = await getSession();
  if (!session) throw new Error('team collect needs a signed-in account');
  const accountId = session.user.id;
  // 팀 수집은 개인 수집 위에 "어디로 보낼지"만 더한다(설계 §1.1). 동의가 없으면 이벤트가 생기지 않아 배지가 거짓이 된다.
  if (!(await hasCollectionConsent(accountId))) throw new CollectConsentRequiredError();
  const deviceId = await getDeviceId();
  // 로컬 창 기록까지 잠금 안에서 끝낸다. 그래야 잠금을 기다리던 끄기(sendOrQueueLocked)가 새 창을 보고 건너뛴다.
  const active = await withServerLock(async (): Promise<ActiveCollect> => {
    // 서버 시작이 이 기기의 열린 창을 어차피 모두 닫는다. 대기 중인 이 기기 끄기 재시도가 남아 있으면
    // 나중에 새 창을 닫으므로(S1) 먼저 걷어 내고, 시작이 실패하면 되돌려 놓는다.
    const stale = await takeStopRetries(accountId, deviceId);
    const requestedAt = Date.now();
    let result: Awaited<ReturnType<typeof startCollect>>;
    try {
      result = await startCollect(workspace.id, deviceId, durationMinutes, TEAM_COLLECT_CONSENT_VERSION);
    } catch (err) {
      for (const item of stale) await queueRetry(item);
      throw err;
    }
    const receivedAt = Date.now();
    // 요청 왕복의 가운데를 서버 시각과 맞춘다.
    const clockOffsetMs = new Date(result.serverNow).getTime() - Math.round((requestedAt + receivedAt) / 2);
    const created: ActiveCollect = {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      hue: workspace.hue,
      windowId: result.window.windowId,
      startedAt: result.window.startedAt,
      expiresAt: result.window.expiresAt,
      clockOffsetMs,
    };
    await serialized(async () => {
      await patchMap<ActiveCollect>(chrome.storage.session, TEAM_COLLECT_KEY, accountId, () => created);
      await patchUi(accountId, { paused: null, ended: null });
    });
    return created;
  });
  await recordTeamConsent(accountId, workspace.id);
  // 사용자 제외 목록은 서버가 다시 판정하지만, 로컬 판정도 같은 목록을 쓰도록 시작할 때 받아 둔다.
  try {
    await setExcludedDomains(accountId, await fetchTeamCollectExcluded());
  } catch (err) {
    console.error('[Orbit] team collect exclusions fetch failed', err);
  }
  return active;
}

/** 개인 수집 동의(현재 버전)가 없어 팀 수집을 시작할 수 없다. 화면은 동의로 안내한다. */
export class CollectConsentRequiredError extends Error {
  constructor() {
    super('personal collection consent is required before team collect');
    this.name = 'CollectConsentRequiredError';
  }
}

/** 일시 정지 뒤 다시 시작 — 남은 시간 안에서 고를 수 있는 가장 긴 길이(최소 30분)로 새 창을 연다. */
export function resumeDuration(remaining: number): CollectDuration {
  const minutes = remaining / 60_000;
  return [...COLLECT_DURATIONS].reverse().find((d) => d <= minutes) ?? COLLECT_DURATIONS[0];
}

// ── 끄기 (로컬 먼저) ────────────────────────────────────────────────

export type EndKind = 'stop' | 'pause' | 'expired' | 'server_closed' | 'browser_restart' | 'account_switch';

const SERVER_REASON: Partial<Record<EndKind, CollectStopReason>> = {
  stop: 'stop',
  pause: 'pause',
  browser_restart: 'browser_restart',
  account_switch: 'account_switch',
};

/**
 * 이 계정의 수집을 끈다. ① 로컬 상태를 먼저 지우고(그 순간부터 방문은 개인) ② 서버 DELETE 를 보낸다.
 * 서버가 이미 끝낸 경우(만료·`window_closed`)는 DELETE 를 보내지 않는다. DELETE 가 실패하면 재시도 목록에 넣는다.
 * `token` 은 계정 전환·로그아웃 때 이전 계정 것이다.
 */
export async function endTeamCollect(
  accountId: string,
  kind: EndKind,
  options: { token?: string } = {},
): Promise<ActiveCollect | null> {
  const active = await serialized(async () => {
    const current = await getActiveCollect(accountId);
    await patchMap<ActiveCollect>(chrome.storage.session, TEAM_COLLECT_KEY, accountId, () => undefined);
    if (current) {
      if (kind === 'pause') {
        await patchUi(accountId, {
          paused: {
            workspaceId: current.workspaceId,
            workspaceName: current.workspaceName,
            hue: current.hue,
            remainingMs: Math.max(0, remainingMs(current)),
          },
        });
      } else if (kind === 'stop' || kind === 'expired' || kind === 'server_closed') {
        await patchUi(accountId, {
          paused: null,
          ended: {
            workspaceId: current.workspaceId,
            workspaceName: current.workspaceName,
            windowId: current.windowId,
            endedAt: new Date().toISOString(),
          },
        });
      }
    }
    return current;
  });

  const reason = SERVER_REASON[kind];
  if (active && reason) {
    const deviceId = await getDeviceId();
    await sendOrQueue(
      { kind: 'stop', accountId, workspaceId: active.workspaceId, deviceId, reason, windowId: active.windowId },
      options.token,
    );
  }
  return active;
}

/** 일시 정지 상태를 버린다(일시 정지 중 `끄기`). */
export async function clearPaused(accountId: string): Promise<void> {
  await serialized(() => patchUi(accountId, { paused: null }));
}

/** 돌아보기를 닫는다. */
export async function dismissReview(accountId: string): Promise<void> {
  await serialized(() => patchUi(accountId, { ended: null }));
}

/** 다른 기기를 포함해 이 팀에 대한 내 모든 창을 끈다(S3). 이 기기 것도 로컬 먼저 끈다. */
export async function stopAllDevices(accountId: string, workspaceId: string): Promise<void> {
  const active = await getActiveCollect(accountId);
  if (active?.workspaceId === workspaceId) {
    await endTeamCollect(accountId, 'stop');
  }
  await stopCollect(workspaceId, null, 'stop');
}

// ── 빼기 (설계 §5.1 끝날 때 돌아보기) ────────────────────────────────

/**
 * 남은 방문도 모두 빼기. ① 로컬 큐의 그 창 방문을 개인으로 ② 서버 `withdraw`. ①만으로는 응답을 잃은
 * 전송 중 배치를 못 고치므로 ②가 필수다. ② 실패는 재시도 목록에 넣고 오류를 다시 던진다.
 */
export async function withdrawTeamWindow(
  accountId: string,
  workspaceId: string,
  windowId: string,
): Promise<WithdrawResult> {
  const active = await getActiveCollect(accountId);
  if (active?.windowId === windowId) {
    // 열린 창을 빼면 서버도 창을 끝낸다(S'3). 로컬을 먼저 끈다.
    await endTeamCollect(accountId, 'server_closed');
  }
  await clearTeamLabels(accountId, windowId);
  try {
    const result = await withdrawWindow(workspaceId, windowId);
    await serialized(async () => {
      const ui = await getCollectUi(accountId);
      await patchUi(accountId, { withdrawPending: (ui.withdrawPending ?? []).filter((id) => id !== windowId) });
    });
    return result;
  } catch (err) {
    await queueRetry({ kind: 'withdraw', accountId, workspaceId, windowId });
    throw err;
  }
}

// ── 서버가 끝낸 창 ─────────────────────────────────────────────────

/**
 * `POST /events` 응답의 `window_closed` 처리. 강등 수(`team_downgraded`)는 제외 목록 동기화 지연으로도
 * 늘어서 끄는 신호로 쓰지 않는다(S'5). 배치에 이전 창(일시 정지 전)의 방문이 섞였으면 그 창 때문일 수
 * 있으므로, 배치의 팀 방문이 모두 지금 창의 것일 때만 끈다. 나머지는 주기 확인(`reconcileWithWorkspaces`)이 맡는다.
 */
export async function handleBatchWindowClosed(
  accountId: string,
  windowClosed: boolean | undefined,
  batchWindowIds: (string | null)[],
): Promise<boolean> {
  if (!windowClosed) return false;
  const active = await getActiveCollect(accountId);
  if (!active) return false;
  const ids = new Set(batchWindowIds.filter((id): id is string => !!id));
  if (ids.size !== 1 || !ids.has(active.windowId)) return false;
  await endTeamCollect(accountId, 'server_closed');
  return true;
}

/**
 * `GET /workspaces` 의 이 기기 창(`myCollect`)에 지금 로컬 창이 없으면 서버가 끝낸 것이다.
 * `checkedWindowId` 는 목록을 받기 전에 본 창이다 — 그 사이 새로 시작한 창을 낡은 목록으로 끄지 않는다.
 */
export async function reconcileWithWorkspaces(
  accountId: string,
  workspaces: Workspace[],
  checkedWindowId?: string,
): Promise<boolean> {
  const active = await getActiveCollect(accountId);
  if (!active) return false;
  if (checkedWindowId !== undefined && active.windowId !== checkedWindowId) return false;
  if (workspaces.some((w) => w.myCollect?.windowId === active.windowId)) return false;
  await endTeamCollect(accountId, 'server_closed');
  return true;
}

/** 주기 확인(1분 알람). 목록을 못 받으면 아무것도 바꾸지 않는다(서버가 최종 판정한다). */
export async function reconcileNow(): Promise<void> {
  const session = await getSession();
  const before = session ? await getActiveCollect(session.user.id) : null;
  if (!session || !before) return;
  let workspaces: Workspace[];
  try {
    workspaces = await fetchWorkspaces();
  } catch {
    return;
  }
  await reconcileWithWorkspaces(session.user.id, workspaces, before.windowId);
}

// ── 브라우저 수명 ──────────────────────────────────────────────────

/**
 * 마지막 일반 Chrome 창이 닫혔을 때(S'4). macOS 에서 창만 닫거나 백그라운드 실행이 켜져 있으면
 * storage.session 이 남으므로 직접 끈다. 모든 계정의 로컬 상태를 먼저 지우고 지금 계정의 서버 창을 끝낸다.
 */
export async function handleWindowRemoved(): Promise<void> {
  const remaining = await chrome.windows.getAll({ windowTypes: ['normal'] });
  if (remaining.length > 0) return;
  const all = await readMap<ActiveCollect>(chrome.storage.session, TEAM_COLLECT_KEY);
  const session = await getSession();
  for (const accountId of Object.keys(all)) {
    if (accountId === session?.user.id) {
      await endTeamCollect(accountId, 'browser_restart');
    } else {
      await serialized(() =>
        patchMap<ActiveCollect>(chrome.storage.session, TEAM_COLLECT_KEY, accountId, () => undefined),
      );
    }
  }
}

/**
 * 브라우저 시작. 로컬 상태는 Chrome 이 이미 지웠다. 서버에 남은 이 기기의 창을 끝내 다른 기기 화면도 맞춘다.
 */
export async function handleBrowserStartup(): Promise<void> {
  await chrome.storage.session.remove(TEAM_COLLECT_KEY);
  const session = await getSession();
  if (!session) return;
  // 시작과 같은 잠금 안에서 본다 — 그 사이 사용자가 연 새 창(로컬 창이 생김)은 닫지 않는다(S1).
  await withServerLock(async () => {
    let workspaces: Workspace[];
    try {
      workspaces = await fetchWorkspaces();
    } catch (err) {
      console.error('[Orbit] team collect startup check failed', err);
      return;
    }
    const deviceId = await getDeviceId();
    const local = await getActiveCollect(session.user.id);
    for (const workspace of workspaces) {
      if (!workspace.myCollect) continue;
      if (local?.windowId === workspace.myCollect.windowId) continue;
      await sendOrQueueLocked({
        kind: 'stop',
        accountId: session.user.id,
        workspaceId: workspace.id,
        deviceId,
        reason: 'browser_restart',
        windowId: workspace.myCollect.windowId,
      });
    }
  });
}

/** 계정 전환·로그아웃. 이전 계정의 로컬 창을 먼저 지우고, 이전 계정 토큰으로 서버 창을 끝낸다(§6.5). */
export async function handleAccountSwitch(previous: AuthSession | null): Promise<void> {
  if (!previous) return;
  const usable = new Date(previous.expiresAt).getTime() > Date.now();
  await endTeamCollect(previous.user.id, 'account_switch', { token: usable ? previous.token : undefined });
}

// ── 재시도 ─────────────────────────────────────────────────────────

async function sendRetryItem(item: RetryItem, token: string): Promise<void> {
  if (item.kind === 'stop') await stopCollect(item.workspaceId, item.deviceId, item.reason, token);
  else await withdrawWindow(item.workspaceId, item.windowId, token);
}

/** 404 는 팀을 잃은 것이다 — 서버가 탈퇴 정리로 창을 이미 닫았으므로 다시 보낼 필요가 없다. */
function isPermanent(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 403);
}

/**
 * 그 항목 계정의 토큰으로만 보낸다(S2). 토큰을 주지 않았으면 지금 세션이 그 계정일 때만 그 토큰을 쓴다.
 * 쓸 토큰이 없으면(만료된 계정 전환·로그아웃) 보내지 않고 큐에 둔다 — 남의 토큰으로 보내면 그 사람의 창을 닫는다.
 */
async function sendOrQueue(item: RetryItem, token?: string): Promise<void> {
  await withServerLock(() => sendOrQueueLocked(item, token));
}

/**
 * 서버 잠금 안에서만 부른다(브라우저 시작 정리는 이미 잠금 안이라 이것을 직접 부른다 — 중첩 잠금 방지).
 * 끄기 항목은, 그 사이 이 계정이 이 기기에서 대상과 다른 새 창을 열었으면 보내지 않는다. 서버 시작이
 * 이 기기의 옛 창을 이미 닫았고, 지금 보내면 새 창을 닫는다(일시 정지 직후 다른 화면에서 시작한 경우).
 * 로컬 창이 바로 그 대상이면 아직 열려 있는 창이므로 보낸다.
 */
async function sendOrQueueLocked(item: RetryItem, token?: string): Promise<void> {
  if (item.kind === 'stop' && item.deviceId && (await isOtherLocalWindow(item.accountId, item.windowId))) return;
  const session = token ? null : await getSession();
  const usable = token ?? (session?.user.id === item.accountId ? session.token : undefined);
  if (!usable) {
    await queueRetry(item);
    return;
  }
  try {
    await sendRetryItem(item, usable);
  } catch (err) {
    if (isPermanent(err)) return;
    console.error('[Orbit] team collect request failed, will retry', err);
    await queueRetry(item);
  }
}

async function isOtherLocalWindow(accountId: string, target: string | undefined): Promise<boolean> {
  const local = await getActiveCollect(accountId);
  return local !== null && (target === undefined || local.windowId !== target);
}

/** 이 계정·기기의 대기 중인 끄기 항목을 꺼낸다(목록에서 지운다). */
async function takeStopRetries(accountId: string, deviceId: string): Promise<RetryItem[]> {
  return serialized(async () => {
    const items = ((await chrome.storage.local.get(RETRY_KEY))[RETRY_KEY] as RetryItem[] | undefined) ?? [];
    const isStale = (item: RetryItem) =>
      item.kind === 'stop' && item.accountId === accountId && item.deviceId === deviceId;
    await chrome.storage.local.set({ [RETRY_KEY]: items.filter((item) => !isStale(item)) });
    return items.filter(isStale);
  });
}

function sameItem(a: RetryItem, b: RetryItem): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function queueRetry(item: RetryItem): Promise<void> {
  await serialized(async () => {
    const stored = await chrome.storage.local.get(RETRY_KEY);
    const items = (stored[RETRY_KEY] as RetryItem[] | undefined) ?? [];
    if (!items.some((existing) => sameItem(existing, item))) items.push(item);
    await chrome.storage.local.set({ [RETRY_KEY]: items });
    if (item.kind === 'withdraw') {
      const ui = await getCollectUi(item.accountId);
      const pending = new Set(ui.withdrawPending ?? []);
      pending.add(item.windowId);
      await patchUi(item.accountId, { withdrawPending: [...pending] });
    }
  });
  await chrome.alarms.create(TEAM_COLLECT_RETRY_ALARM, { delayInMinutes: 1 });
}

/**
 * 재시도 알람. 지금 로그인한 계정의 항목만 그 계정 토큰으로 보낸다(다른 계정 것은 그 계정이 다시
 * 로그인할 때). 서버는 창을 만료 시각에 스스로 끝내므로, 끝내 못 보내도 팀 판정은 열리지 않는다.
 */
export async function retryTeamCollectRequests(): Promise<void> {
  await withServerLock(retryLocked);
}

async function retryLocked(): Promise<void> {
  const session = await getSession();
  if (!session) return;
  const stored = await chrome.storage.local.get(RETRY_KEY);
  const items = (stored[RETRY_KEY] as RetryItem[] | undefined) ?? [];
  const done: RetryItem[] = [];
  let failed = false;
  for (const item of items) {
    if (item.accountId !== session.user.id) continue;
    try {
      await sendRetryItem(item, session.token);
      done.push(item);
    } catch (err) {
      if (isPermanent(err)) done.push(item);
      else failed = true;
    }
  }
  await serialized(async () => {
    const latest = ((await chrome.storage.local.get(RETRY_KEY))[RETRY_KEY] as RetryItem[] | undefined) ?? [];
    await chrome.storage.local.set({ [RETRY_KEY]: latest.filter((item) => !done.some((d) => sameItem(d, item))) });
    const withdrawn = done.filter((d) => d.kind === 'withdraw').map((d) => (d as { windowId: string }).windowId);
    if (withdrawn.length) {
      const ui = await getCollectUi(session.user.id);
      await patchUi(session.user.id, {
        withdrawPending: (ui.withdrawPending ?? []).filter((id) => !withdrawn.includes(id)),
      });
    }
  });
  if (failed) await chrome.alarms.create(TEAM_COLLECT_RETRY_ALARM, { delayInMinutes: 2 });
}

// ── 배지 (설계 §8.1-3) ─────────────────────────────────────────────

export function formatRemaining(ms: number): string {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

/**
 * 확장 아이콘 배지를 지금 계정의 창에 맞춘다. 만료됐으면 로컬 상태도 끝낸다(서버는 이미 끝냈다).
 * 1분 알람으로 남은 시간과 만료를 따라간다 — 사이드패널을 닫아도 배지는 남는다.
 */
export async function syncTeamCollectBadge(): Promise<void> {
  const session = await getSession();
  let active = session ? await getActiveCollect(session.user.id) : null;
  if (session && active && remainingMs(active) <= 0) {
    await endTeamCollect(session.user.id, 'expired');
    active = null;
  }
  if (!active) {
    await chrome.action.setBadgeText({ text: '' });
    await chrome.action.setTitle({ title: chrome.runtime.getManifest().action?.default_title ?? '' });
    await chrome.alarms.clear(TEAM_COLLECT_TICK_ALARM);
    return;
  }
  const left = remainingMs(active);
  const soon = left <= EXPIRY_WARNING_MS;
  await chrome.action.setBadgeText({ text: '팀' });
  await chrome.action.setBadgeBackgroundColor({ color: active.hue || '#727bcb' });
  await chrome.action.setTitle({
    title: `${active.workspaceName}으로 수집 중 · ${formatRemaining(left)} 남음${soon ? ' · 곧 꺼져요' : ''}`,
  });
  await chrome.alarms.create(TEAM_COLLECT_TICK_ALARM, { periodInMinutes: 1 });
}

// ── SW 등록 ────────────────────────────────────────────────────────

/** 백그라운드 최초 tick 에 동기적으로 리스너를 건다(MV3 SW 재시작 뒤에도 이벤트를 받도록). */
export function initTeamCollect(): void {
  const log = (label: string) => (err: unknown) => console.error(`[Orbit] team collect ${label} failed`, err);

  chrome.runtime.onStartup.addListener(() => {
    handleBrowserStartup().catch(log('startup')).finally(() => void syncTeamCollectBadge().catch(log('badge')));
  });
  chrome.windows.onRemoved.addListener(() => {
    handleWindowRemoved().catch(log('last window'));
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === TEAM_COLLECT_RETRY_ALARM) retryTeamCollectRequests().catch(log('retry'));
    // 1분마다 서버가 창을 끝냈는지(owner 허용 끄기·다른 기기에서 끄기·탈퇴) 확인하고 배지를 맞춘다.
    if (alarm.name === TEAM_COLLECT_TICK_ALARM) {
      reconcileNow()
        .catch(log('reconcile'))
        .finally(() => void syncTeamCollectBadge().catch(log('badge')));
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && TEAM_COLLECT_KEY in changes) syncTeamCollectBadge().catch(log('badge'));
  });
  syncTeamCollectBadge().catch(log('badge'));
  // 확장 업데이트로 재시도 알람이 지워졌을 수 있다 — SW 가 뜰 때 한 번 다시 보낸다.
  retryTeamCollectRequests().catch(log('retry'));
}
