// 동기화 트리거 4종(수동/주기/개수/유휴)을 등록하고 sync/engine.ts의 requestDrain으로 수렴시킨다.
// SW 시작 시 stale-syncing 리셋 + prune + evict도 이 모듈이 담당한다.
// 계약 근거: docs/target-architecture.md §4, docs/implementation-roadmap.md M2-10

import { getSession, onSessionChange } from '../auth';
import {
  getCollectionConsent,
  getSettings,
  subscribeSettings,
  updateSettings,
  type OrbitSettings,
} from '../settings';
import { finalizeOrphanOpenEvents } from '../events/collector';
import {
  evictIfOver,
  getSyncStatus,
  prune,
  resetStaleSyncing,
  setPendingChangeListener,
  updateSyncStatus,
} from '../events/queue';
import { drainPreviousAccount, requestDrain, RETRY_ALARM_NAME } from './engine';

const SYNC_ALARM_NAME = 'orbit-sync';
/** 유휴 상태가 idleSyncMin(분) 동안 지속되면 실제로 drain('idle')을 실행하는 1회성 알람. */
const IDLE_DRAIN_ALARM_NAME = 'orbit-idle-drain';
const STALE_SYNCING_THRESHOLD_MS = 5 * 60 * 1000;
const QUEUE_LIMIT = 5000;

async function syncAlarmForSettings(settings: OrbitSettings): Promise<void> {
  if (settings.autoSyncEnabled) {
    await chrome.alarms.create(SYNC_ALARM_NAME, { periodInMinutes: settings.autoSyncIntervalMin });
  } else {
    await chrome.alarms.clear(SYNC_ALARM_NAME);
  }
}

/**
 * chrome.idle은 setDetectionInterval(60)(collector.ts, 체류시간용)로 60초 단위로만 상태를
 * 알려준다. "유휴가 idleSyncMin분 지속되면 동기화"라는 조건은 idle 진입 시 idleSyncMin분짜리
 * 1회성 알람을 예약하고, active로 돌아오면 취소하는 방식으로 구현한다(setTimeout은 SW가
 * 중간에 종료되면 유실되므로 쓰지 않는다 — chrome.alarms만 SW 재시작에도 살아남는다).
 */
function watchIdleForDrain(): void {
  chrome.idle.onStateChanged.addListener((state) => {
    if (state === 'idle') {
      getSettings()
        .then((settings) =>
          chrome.alarms.create(IDLE_DRAIN_ALARM_NAME, { delayInMinutes: settings.idleSyncMin }),
        )
        .catch((err) => console.error('[Orbit] idle 동기화 알람 예약 실패', err));
    } else {
      chrome.alarms.clear(IDLE_DRAIN_ALARM_NAME).catch(() => {});
    }
  });
}

function watchPendingThreshold(): void {
  setPendingChangeListener((pendingCount) => {
    getSettings()
      .then((settings) => {
        if (pendingCount >= settings.countThreshold) requestDrain('threshold');
      })
      .catch((err) => console.error('[Orbit] 개수 트리거 확인 실패', err));
  });
}

/**
 * 수집 스위치를 지금 계정의 동의로 맞춘다. 다른 계정이 로그인하면 그 계정이 동의하기 전까지
 * 수집이 멈추고 화면에 동의 안내가 다시 나온다. `migrationOwner`는 계정별 동의로 처음 옮길 때의
 * 주인이다 — 로그아웃 직후에 처음 옮기면 지금 세션이 없으므로 이전 계정을 넘긴다.
 */
export async function applyAccountConsent(migrationOwner?: string): Promise<void> {
  const consent = await getCollectionConsent(migrationOwner);
  const session = await getSession();
  const enabled = session ? consent[session.user.id] === true : false;
  if ((await getSettings()).collectionEnabled !== enabled) {
    await updateSettings({ collectionEnabled: enabled });
  }
}

/**
 * 로그아웃·계정 교체 때 이전 계정의 남은 이벤트는 그 계정 토큰으로만 보낸다(못 보내면 그 계정
 * 것으로 남아 다음 로그인 때 보낸다). 동기화 요약은 새 계정 기준으로 다시 센다.
 */
function watchAccountChange(): void {
  onSessionChange((session, previous) => {
    if (session?.user.id === previous?.user.id) return;
    applyAccountConsent(previous?.user.id ?? session?.user.id).catch((err) =>
      console.error('[Orbit] 계정 전환 뒤 수집 동의 적용 실패', err),
    );
    updateSyncStatus({ lastSyncAt: null, lastError: null }).catch((err) =>
      console.error('[Orbit] 계정 전환 뒤 동기화 상태 갱신 실패', err),
    );
    // 만료로 지워진 세션은 토큰이 이미 거절되므로 보내 보지 않는다.
    if (previous && new Date(previous.expiresAt).getTime() > Date.now()) {
      drainPreviousAccount(previous);
    }
  });
}

function registerMessageHandlers(): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'SYNC_NOW') {
      requestDrain('manual');
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === 'GET_SYNC_STATUS') {
      getSyncStatus().then(sendResponse);
      return true;
    }
    return false;
  });
}

function registerAlarmHandlers(): void {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM_NAME) requestDrain('periodic');
    if (alarm.name === RETRY_ALARM_NAME) requestDrain('retry');
    if (alarm.name === IDLE_DRAIN_ALARM_NAME) requestDrain('idle');
  });
}

async function runStartupMaintenance(): Promise<void> {
  try {
    // 업데이트 직후 계정별 동의로 옮기고, SW가 꺼져 있던 사이의 계정 변경도 따라잡는다.
    await applyAccountConsent();
  } catch (err) {
    console.error('[Orbit] 수집 동의 적용 실패', err);
  }
  try {
    await finalizeOrphanOpenEvents();
  } catch (err) {
    console.error('[Orbit] finalizeOrphanOpenEvents 실패', err);
  }
  try {
    await resetStaleSyncing(STALE_SYNCING_THRESHOLD_MS);
  } catch (err) {
    console.error('[Orbit] resetStaleSyncing 실패', err);
  }
  try {
    await prune();
  } catch (err) {
    console.error('[Orbit] prune 실패', err);
  }
  try {
    await evictIfOver(QUEUE_LIMIT);
  } catch (err) {
    console.error('[Orbit] evictIfOver 실패', err);
  }
}

export function initTriggers(): void {
  registerMessageHandlers();
  registerAlarmHandlers();
  watchIdleForDrain();
  watchPendingThreshold();
  watchAccountChange();

  getSettings()
    .then((settings) => syncAlarmForSettings(settings))
    .catch((err) => console.error('[Orbit] 초기 동기화 알람 설정 실패', err));

  subscribeSettings((settings) => {
    syncAlarmForSettings(settings).catch((err) =>
      console.error('[Orbit] 동기화 알람 갱신 실패', err),
    );
  });

  runStartupMaintenance().catch((err) => console.error('[Orbit] 시작 정리 작업 실패', err));
}
