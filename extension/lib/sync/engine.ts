// 동기화 엔진 — 4개 트리거(수동/주기/개수/유휴)가 모두 이 진입점으로 수렴한다.
// navigator.locks 뮤텍스로 동시 실행을 막고, 실패 시 지수 백오프 + 1회성 재시도 알람을 예약한다.
// 계약 근거: docs/target-architecture.md §4, §5, docs/implementation-roadmap.md M2-10

import { postEventBatch, triggerServerSync, type ServerSyncTrigger } from '../api';
import {
  claimPending,
  finalizeAllOpen,
  markSynced,
  releaseToPending,
  updateSyncStatus,
} from '../events/queue';
import { toWire } from '../events/types';

const BATCH_SIZE = 50;
const DRAIN_LOCK_NAME = 'orbit-drain';
const DEVICE_ID_KEY = 'orbit:deviceId';

/** 재시도 알람 이름 — sync/triggers.ts의 onAlarm 리스너와 공유한다. */
export const RETRY_ALARM_NAME = 'orbit-retry';

export type DrainReason = 'manual' | 'periodic' | 'threshold' | 'idle' | 'retry';

let deviceIdPromise: Promise<string> | null = null;

async function getDeviceId(): Promise<string> {
  if (!deviceIdPromise) {
    deviceIdPromise = (async () => {
      const stored = await chrome.storage.local.get(DEVICE_ID_KEY);
      const existing = stored[DEVICE_ID_KEY] as string | undefined;
      if (existing) return existing;
      const generated = crypto.randomUUID();
      await chrome.storage.local.set({ [DEVICE_ID_KEY]: generated });
      return generated;
    })();
  }
  return deviceIdPromise;
}

async function scheduleRetry(released: Awaited<ReturnType<typeof releaseToPending>>): Promise<void> {
  const now = Date.now();
  const nextAttempts = released
    .map((e) => (e.nextAttemptAt ? new Date(e.nextAttemptAt).getTime() : null))
    .filter((t): t is number => t !== null);
  const earliest = nextAttempts.length ? Math.min(...nextAttempts) : now + 2 * 60_000;
  const delayInMinutes = Math.max(1, Math.ceil((earliest - now) / 60_000));
  chrome.alarms.create(RETRY_ALARM_NAME, { delayInMinutes });
}

// retry는 자동 배경 재전송이므로 사용자 액션(manual)이 아니라 periodic으로 근사한다.
const SERVER_TRIGGER_BY_REASON: Record<DrainReason, ServerSyncTrigger> = {
  manual: 'manual',
  periodic: 'periodic',
  threshold: 'event_count',
  idle: 'idle',
  retry: 'periodic',
};

async function drain(reason: DrainReason): Promise<void> {
  if (reason === 'manual') {
    try {
      await finalizeAllOpen();
    } catch (err) {
      console.error('[Orbit] finalizeAllOpen 실패', err);
    }
  }

  const deviceId = await getDeviceId();
  let sentAny = false;

  for (;;) {
    const batch = await claimPending(BATCH_SIZE);
    if (batch.length === 0) break;

    try {
      await postEventBatch(deviceId, batch.map(toWire));
      await markSynced(batch.map((e) => e.eventId));
      await updateSyncStatus({ lastSyncAt: new Date().toISOString(), lastError: null });
      sentAny = true;
      // 배치가 가득 찼을 수 있으니(pending이 더 있을 가능성) 계속 반복한다.
      continue;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const released = await releaseToPending(
        batch.map((e) => e.eventId),
        { backoff: true },
      );
      await updateSyncStatus({ lastError: message });
      await scheduleRetry(released);
      return; // fail-open — 실패 시 이번 drain은 중단하고 예약된 알람이 재시도한다.
    }
  }

  // 이벤트 전송만으로는 세션이 만들어지지 않는다 — 서버 배치 세션화를 명시적으로 트리거한다.
  // manual은 보낼 이벤트가 없어도 호출(서버에 이미 쌓인 pending을 사용자가 지금 분석하길 원한 것).
  if (sentAny || reason === 'manual') {
    try {
      await triggerServerSync(SERVER_TRIGGER_BY_REASON[reason]);
    } catch (err) {
      // 이벤트는 이미 서버에 안전하게 저장됨 — 세션화는 서버 임계값/주기 루프가 이어받는다.
      console.error('[Orbit] 서버 세션화 트리거 실패', err);
    }
  }
}

/**
 * 트리거 진입점. 이미 다른 drain이 진행 중이면(navigator.locks가 잠겨 있으면) 조용히 스킵한다.
 */
export function requestDrain(reason: DrainReason): void {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    // navigator.locks 미지원 환경(테스트 등) — 뮤텍스 없이 실행하되 실패는 삼킨다.
    drain(reason).catch((err) => console.error('[Orbit] drain 실패', err));
    return;
  }

  navigator.locks
    .request(DRAIN_LOCK_NAME, { ifAvailable: true }, async (lock) => {
      if (!lock) return; // 이미 잠겨 있음 — 스킵
      await drain(reason);
    })
    .catch((err) => console.error('[Orbit] drain 락 처리 실패', err));
}
