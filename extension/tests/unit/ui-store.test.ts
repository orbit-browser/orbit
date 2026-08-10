import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUIStore } from '../../entrypoints/sidepanel/store/ui';

beforeEach(() => {
  vi.useFakeTimers();
  useUIStore.getState().dismissToast();
  useUIStore.getState().closeAllSheets();
});

afterEach(() => {
  useUIStore.getState().dismissToast();
  useUIStore.getState().closeAllSheets();
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

describe('시트 스택', () => {
  const kinds = () => useUIStore.getState().sheets.map((sheet) => sheet.kind);

  it('열면 쌓이고 닫으면 한 장씩 벗겨진다', () => {
    useUIStore.getState().openSheet({ kind: 'sessions' });
    useUIStore.getState().openSheet({ kind: 'settings' });

    expect(kinds()).toEqual(['sessions', 'settings']);

    useUIStore.getState().closeSheet();
    expect(kinds()).toEqual(['sessions']);
  });

  it('같은 시트를 다시 열어도 스택이 늘지 않는다', () => {
    useUIStore.getState().openSheet({ kind: 'timeline' });
    useUIStore.getState().openSheet({ kind: 'timeline' });

    expect(kinds()).toEqual(['timeline']);
  });

  it('빈 스택에서 닫아도 터지지 않는다', () => {
    expect(() => useUIStore.getState().closeSheet()).not.toThrow();
    expect(kinds()).toEqual([]);
  });

  it('closeAllSheets 로 홈으로 돌아간다', () => {
    useUIStore.getState().openSheet({ kind: 'sessions' });
    useUIStore.getState().closeAllSheets();

    expect(kinds()).toEqual([]);
  });
});

describe('세션 펼치기', () => {
  const kinds = () => useUIStore.getState().sheets.map((sheet) => sheet.kind);

  it('목록 시트를 열고 그 안에서 펼친다 — 시트를 새로 쌓지 않는다', () => {
    useUIStore.getState().openSession('s1');

    expect(kinds()).toEqual(['sessions']);
    expect(useUIStore.getState().expandedSessionId).toBe('s1');
  });

  it('이미 목록이 열려 있으면 다시 쌓지 않는다', () => {
    useUIStore.getState().openSheet({ kind: 'sessions' });
    useUIStore.getState().openSession('s1');
    useUIStore.getState().openSession('s2');

    expect(kinds()).toEqual(['sessions']);
    expect(useUIStore.getState().expandedSessionId).toBe('s2');
  });

  it('다른 시트에서 세션을 열어도 그 시트를 잃지 않는다', () => {
    useUIStore.getState().openSheet({ kind: 'ask' });
    useUIStore.getState().openSession('s1');

    // Ask 대화 도중 관련 세션을 열었다가 닫으면 대화로 돌아와야 한다.
    expect(kinds()).toEqual(['ask', 'sessions']);
  });

  it('접으면 목록만 남는다', () => {
    useUIStore.getState().openSession('s1');
    useUIStore.getState().collapseSession();

    expect(kinds()).toEqual(['sessions']);
    expect(useUIStore.getState().expandedSessionId).toBeNull();
  });

  it('목록 시트를 닫으면 펼침 상태도 함께 접힌다', () => {
    // 남겨 두면 다음에 목록을 열었을 때 엉뚱한 세션이 펼쳐진 채로 뜬다.
    useUIStore.getState().openSession('s1');
    useUIStore.getState().closeSheet();

    expect(useUIStore.getState().expandedSessionId).toBeNull();
  });

  it('closeAllSheets 도 펼침 상태를 지운다', () => {
    useUIStore.getState().openSession('s1');
    useUIStore.getState().closeAllSheets();

    expect(useUIStore.getState().expandedSessionId).toBeNull();
  });
});
