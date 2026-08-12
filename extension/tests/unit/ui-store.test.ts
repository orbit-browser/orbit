import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAskDockView, useUIStore } from '../../entrypoints/sidepanel/store/ui';

beforeEach(() => {
  vi.useFakeTimers();
  useUIStore.getState().dismissToast();
});

afterEach(() => {
  useUIStore.getState().dismissToast();
  vi.useRealTimers();
});

describe('sidepanel ask 오버레이', () => {
  it('메인 세 탭에서만 입력창을 띄운다', () => {
    expect(isAskDockView('timeline')).toBe(true);
    expect(isAskDockView('sessions')).toBe(true);
    expect(isAskDockView('tabs')).toBe(true);
    expect(isAskDockView('detail')).toBe(false);
    expect(isAskDockView('settings')).toBe(false);
  });

  it('세션을 열면 답변 화면을 닫는다 — 상세에는 독이 없어 되돌릴 수 없다', () => {
    useUIStore.getState().openAsk();
    expect(useUIStore.getState().askOpen).toBe(true);

    useUIStore.getState().openSession('session-1');

    expect(useUIStore.getState().askOpen).toBe(false);
    expect(useUIStore.getState().activeView).toBe('detail');
    expect(useUIStore.getState().selectedSessionId).toBe('session-1');
  });

  it('닫아도 탭 전환 상태는 건드리지 않는다', () => {
    useUIStore.getState().setView('tabs');
    useUIStore.getState().openAsk();
    useUIStore.getState().closeAsk();

    expect(useUIStore.getState().askOpen).toBe(false);
    expect(useUIStore.getState().activeView).toBe('tabs');
  });
});

describe('sidepanel toast', () => {
  it('액션 토스트를 6초 동안 유지한다', () => {
    const onClick = vi.fn();
    useUIStore.getState().showToast('병합 완료', { label: '되돌리기', onClick });

    expect(useUIStore.getState().toast).toMatchObject({
      message: '병합 완료',
      action: { label: '되돌리기' },
    });
    vi.advanceTimersByTime(5_999);
    expect(useUIStore.getState().toast).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(useUIStore.getState().toast).toBeNull();
  });

  it('새 토스트가 이전 토스트의 타이머에 의해 지워지지 않는다', () => {
    useUIStore.getState().showToast('첫 번째');
    vi.advanceTimersByTime(1_000);
    useUIStore.getState().showToast('두 번째');

    vi.advanceTimersByTime(1_000);
    expect(useUIStore.getState().toast?.message).toBe('두 번째');
    vi.advanceTimersByTime(1_000);
    expect(useUIStore.getState().toast).toBeNull();
  });
});
