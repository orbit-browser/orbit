import { beforeEach, describe, expect, it, vi } from 'vitest';
import { broadcastSessionChange, onSessionChange } from '../../lib/session-events';

let listeners: Array<(message: unknown) => void>;

beforeEach(() => {
  listeners = [];
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: vi.fn((message: unknown) => {
        listeners.forEach((fn) => fn(message));
        return Promise.resolve();
      }),
      onMessage: {
        addListener: (fn: (m: unknown) => void) => listeners.push(fn),
        removeListener: (fn: (m: unknown) => void) => {
          listeners = listeners.filter((l) => l !== fn);
        },
      },
    },
  });
});

describe('세션 변경 브로드캐스트', () => {
  it('병합 알림이 구독자에게 전달된다', () => {
    const received: unknown[] = [];
    onSessionChange((change) => received.push(change));

    broadcastSessionChange({ type: 'sessions:merged', survivorId: 'a', absorbedId: 'b' });

    expect(received).toEqual([{ type: 'sessions:merged', survivorId: 'a', absorbedId: 'b' }]);
  });

  it('세션과 무관한 메시지는 무시한다', () => {
    const received: unknown[] = [];
    onSessionChange((change) => received.push(change));

    listeners.forEach((fn) => fn({ type: 'TABS_CHANGED' }));
    listeners.forEach((fn) => fn('문자열'));
    listeners.forEach((fn) => fn(null));

    expect(received).toEqual([]);
  });

  it('구독 해제 후에는 받지 않는다', () => {
    const received: unknown[] = [];
    const unsubscribe = onSessionChange((change) => received.push(change));

    unsubscribe();
    broadcastSessionChange({ type: 'sessions:changed' });

    expect(received).toEqual([]);
  });

  it('받는 쪽이 없어도 예외를 던지지 않는다', () => {
    // 새 탭이 안 열려 있으면 크롬이 거부하는데, 이는 정상 상황이다.
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn(() => Promise.reject(new Error('Receiving end does not exist'))),
        onMessage: { addListener: () => {}, removeListener: () => {} },
      },
    });

    expect(() => broadcastSessionChange({ type: 'sessions:changed' })).not.toThrow();
  });

  it('확장 컨텍스트 밖에서도 터지지 않는다', () => {
    vi.stubGlobal('chrome', undefined);

    expect(() => broadcastSessionChange({ type: 'sessions:changed' })).not.toThrow();
    expect(() => onSessionChange(() => {})()).not.toThrow();
  });
});
