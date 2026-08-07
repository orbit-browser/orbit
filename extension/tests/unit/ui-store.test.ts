import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUIStore } from '../../entrypoints/sidepanel/store/ui';

beforeEach(() => {
  vi.useFakeTimers();
  useUIStore.getState().dismissToast();
});

afterEach(() => {
  useUIStore.getState().dismissToast();
  vi.useRealTimers();
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
