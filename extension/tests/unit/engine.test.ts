import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { postEventBatch, triggerServerSync } from '../../lib/api';
import {
  addEvent,
  finalizeOpenEvent,
  getEvent,
  listByStatus,
  getSyncStatus,
  setPendingChangeListener,
} from '../../lib/events/queue';
import { requestDrain, RETRY_ALARM_NAME } from '../../lib/sync/engine';
import { clearEvents, makeInput } from '../helpers';

vi.mock('../../lib/api', () => ({
  postEventBatch: vi.fn().mockResolvedValue({ accepted: 0, duplicates: 0, filtered: 0, pending_total: 0 }),
  triggerServerSync: vi.fn().mockResolvedValue(undefined),
}));

const mockPost = vi.mocked(postEventBatch);
const mockServerSync = vi.mocked(triggerServerSync);

beforeEach(async () => {
  fakeBrowser.reset();
  setPendingChangeListener(null);
  await clearEvents();
  mockPost.mockClear().mockResolvedValue({ accepted: 0, duplicates: 0, filtered: 0, pending_total: 0 });
  mockServerSync.mockClear().mockResolvedValue(undefined);
});

async function seedPending(count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const event = await addEvent(makeInput());
    await finalizeOpenEvent(event.eventId, new Date().toISOString());
    ids.push(event.eventId);
  }
  return ids;
}

/** requestDrain은 fire-and-forget이므로 조건 충족을 폴링으로 기다린다. */
function waitUntil(assertion: () => void | Promise<void>) {
  return vi.waitFor(assertion, { timeout: 3000 });
}

describe('drain 성공 경로', () => {
  it('manual은 open 이벤트를 먼저 마감한 뒤 전송하고 synced로 표시한다', async () => {
    await addEvent(makeInput());
    await addEvent(makeInput());

    requestDrain('manual');

    await waitUntil(async () => {
      expect(await listByStatus('synced')).toHaveLength(2);
    });
    expect(mockPost).toHaveBeenCalledTimes(1);
    const [, wireEvents] = mockPost.mock.calls[0];
    expect(wireEvents).toHaveLength(2);
    expect(mockServerSync).toHaveBeenCalledWith('manual');

    const status = await getSyncStatus();
    expect(status.lastSyncAt).toBeTruthy();
    expect(status.lastError).toBeNull();
  });

  it('BATCH_SIZE(50) 초과 pending은 배치를 반복해 모두 전송한다', async () => {
    await seedPending(60);

    requestDrain('periodic');

    // 서버 세션화 트리거는 synced 표시 **뒤에** 일어난다. synced 개수만 기다리면
    // 아직 호출되지 않은 상태에서 단정하게 되어 부하가 걸릴 때 간헐적으로 실패한다.
    await waitUntil(async () => {
      expect(await listByStatus('synced')).toHaveLength(60);
      expect(mockServerSync).toHaveBeenCalledTimes(1);
    });
    expect(mockPost).toHaveBeenCalledTimes(2);
    expect(mockPost.mock.calls[0][1]).toHaveLength(50);
    expect(mockPost.mock.calls[1][1]).toHaveLength(10);
    // 서버 세션화 트리거는 drain당 1회만
    expect(mockServerSync).toHaveBeenCalledWith('periodic');
  });

  it('트리거 사유를 서버 trigger 타입으로 매핑한다 (threshold→event_count)', async () => {
    await seedPending(1);

    requestDrain('threshold');

    await waitUntil(() => {
      expect(mockServerSync).toHaveBeenCalledWith('event_count');
    });
  });

  it('보낼 이벤트가 없는 non-manual drain은 전송도 세션화 트리거도 하지 않는다', async () => {
    requestDrain('periodic');

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockServerSync).not.toHaveBeenCalled();
  });

  it('보낼 이벤트가 없어도 manual은 서버 세션화를 트리거한다', async () => {
    requestDrain('manual');

    await waitUntil(() => {
      expect(mockServerSync).toHaveBeenCalledWith('manual');
    });
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe('drain 실패 경로', () => {
  it('전송 실패 시 pending으로 복귀(백오프) + lastError 기록 + 재시도 알람 예약, 세션화는 미트리거', async () => {
    const alarmSpy = vi.spyOn(fakeBrowser.alarms, 'create');
    const [id] = await seedPending(1);
    mockPost.mockRejectedValue(new Error('server down'));

    requestDrain('periodic');

    await waitUntil(async () => {
      const event = await getEvent(id);
      expect(event!.status).toBe('pending');
      expect(event!.failureCount).toBe(1);
    });

    const event = await getEvent(id);
    expect(event!.nextAttemptAt).toBeTruthy();

    const status = await getSyncStatus();
    expect(status.lastError).toBe('server down');

    expect(alarmSpy).toHaveBeenCalledWith(
      RETRY_ALARM_NAME,
      expect.objectContaining({ delayInMinutes: expect.any(Number) }),
    );
    // fakeBrowser 타입은 create(alarmInfo) 단일 인자 오버로드만 선언하지만
    // 런타임은 polyfill과 같은 (name, alarmInfo) 2인자 호출을 지원한다.
    const lastCall = alarmSpy.mock.calls.at(-1)! as unknown as [
      string,
      { delayInMinutes?: number },
    ];
    const delay = lastCall[1].delayInMinutes!;
    expect(delay).toBeGreaterThanOrEqual(1);
    expect(delay).toBeLessThanOrEqual(2);

    expect(mockServerSync).not.toHaveBeenCalled();
  });

  it('세션화 트리거 실패는 drain을 실패시키지 않는다(이벤트는 이미 synced)', async () => {
    await seedPending(1);
    mockServerSync.mockRejectedValue(new Error('sync endpoint down'));

    requestDrain('periodic');

    await waitUntil(async () => {
      expect(await listByStatus('synced')).toHaveLength(1);
    });
    const status = await getSyncStatus();
    expect(status.lastError).toBeNull();
  });
});
