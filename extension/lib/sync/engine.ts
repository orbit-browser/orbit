// 동기화 엔진 — 4개 트리거(수동/주기/개수/유휴)가 모두 이 진입점으로 수렴한다.
// navigator.locks 뮤텍스로 동시 실행을 막고, 실패 시 지수 백오프 + 1회성 재시도 알람을 예약한다.
// 계약 근거: docs/target-architecture.md §4, §5, docs/implementation-roadmap.md M2-10

import { postEventBatch, triggerServerSync, type ServerSyncTrigger } from '../api';
import { getSession, type AuthSession } from '../auth';
import {
  claimPending,
  finalizeAllOpen,
  markSynced,
  releaseToPending,
  updateSyncStatus,
} from '../events/queue';
import { toWire } from '../events/types';
import { getDeviceId } from '../device-id';
import { handleBatchWindowClosed, reconcileNow } from '../team-collect';

const BATCH_SIZE = 50;
const DRAIN_LOCK_NAME = 'orbit-drain';

/** 재시도 알람 이름 — sync/triggers.ts의 onAlarm 리스너와 공유한다. */
export const RETRY_ALARM_NAME = 'orbit-retry';

/** signout: 로그아웃·계정 교체 직후 이전 계정의 남은 이벤트를 그 계정 토큰으로 보낸다. */
export type DrainReason = 'manual' | 'periodic' | 'threshold' | 'idle' | 'retry' | 'signout';

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
  signout: 'periodic',
};

/**
 * `owner`가 없으면 지금 로그인한 계정의 이벤트만 그 계정 토큰으로 보낸다. 로그아웃 상태면 보내지
 * 않는다 — 주인이 확인되지 않은 전송은 다음에 로그인하는 계정으로 올라가 버린다.
 */
async function drain(reason: DrainReason, owner?: AuthSession): Promise<void> {
  const session = owner ?? (await getSession());
  if (!session) return;
  // 이전 계정을 비우는 drain의 성공·실패를 지금 계정의 동기화 상태로 보여 주지 않는다.
  const reportStatus = owner === undefined;

  if (reason === 'manual' || reason === 'signout') {
    try {
      await finalizeAllOpen();
    } catch (err) {
      console.error('[Orbit] finalizeAllOpen 실패', err);
    }
  }

  const deviceId = await getDeviceId();
  let sentAny = false;

  for (;;) {
    const batch = await claimPending(BATCH_SIZE, session.user.id);
    if (batch.length === 0) break;

    try {
      const result = await postEventBatch(deviceId, batch.map(toWire), session.token);
      await markSynced(batch.map((e) => e.eventId));
      // 서버가 이 창을 이미 끝냈으면(owner 허용 끄기·다른 기기에서 끄기·탈퇴) 로컬 수집도 끈다.
      try {
        await handleBatchWindowClosed(
          session.user.id,
          result?.window_closed,
          batch.map((e) => e.collectWindowId ?? null),
        );
      } catch (err) {
        console.error('[Orbit] team collect window_closed handling failed', err);
      }
      if (reportStatus) {
        await updateSyncStatus({ lastSyncAt: new Date().toISOString(), lastError: null });
      }
      sentAny = true;
      // 배치가 가득 찼을 수 있으니(pending이 더 있을 가능성) 계속 반복한다.
      continue;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const released = await releaseToPending(
        batch.map((e) => e.eventId),
        { backoff: true },
      );
      if (reportStatus) await updateSyncStatus({ lastError: message });
      await scheduleRetry(released);
      return; // fail-open — 실패 시 이번 drain은 중단하고 예약된 알람이 재시도한다.
    }
  }

  // 이벤트 전송만으로는 세션이 만들어지지 않는다 — 서버 배치 세션화를 명시적으로 트리거한다.
  // manual은 보낼 이벤트가 없어도 호출(서버에 이미 쌓인 pending을 사용자가 지금 분석하길 원한 것).
  // 보낼 방문이 없어도 서버가 창을 끝냈는지 주기마다 확인한다(`my_collect`). 이전 계정 drain 은 제외.
  if (reportStatus && (reason === 'periodic' || reason === 'manual')) {
    await reconcileNow().catch((err) => console.error('[Orbit] team collect reconcile failed', err));
  }

  if (sentAny || reason === 'manual') {
    try {
      await triggerServerSync(SERVER_TRIGGER_BY_REASON[reason], session.token);
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
  runLocked(() => drain(reason), { ifAvailable: true });
}

/**
 * 로그아웃·계정 교체 직후 이전 계정의 남은 이벤트를 그 계정 토큰으로 보낸다. 진행 중인 drain이
 * 있으면 건너뛰지 않고 기다린다 — 건너뛰면 그 계정이 다시 로그인할 때까지 전송이 미뤄진다.
 * 실패한 이벤트는 그 계정 것으로 남아 다음 로그인 때 보내진다.
 */
export function drainPreviousAccount(owner: AuthSession): void {
  runLocked(() => drain('signout', owner), { ifAvailable: false });
}

function runLocked(task: () => Promise<void>, opts: { ifAvailable: boolean }): void {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    // navigator.locks 미지원 환경(테스트 등) — 뮤텍스 없이 실행하되 실패는 삼킨다.
    task().catch((err) => console.error('[Orbit] drain 실패', err));
    return;
  }

  navigator.locks
    .request(DRAIN_LOCK_NAME, opts, async (lock) => {
      if (!lock) return; // ifAvailable이고 이미 잠겨 있음 — 스킵
      await task();
    })
    .catch((err) => console.error('[Orbit] drain 락 처리 실패', err));
}
