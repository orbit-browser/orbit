import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import {
  completeOnboarding,
  getOnboardingState,
  openOnboardingForInstall,
  prepareOnboarding,
  setOnboardingStep,
  startOnboarding,
} from '../../lib/onboarding';

beforeEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

describe('온보딩 상태', () => {
  it('저장값이 없으면 기존 사용자로 간주해 완료 상태다', async () => {
    expect(await getOnboardingState()).toEqual({ status: 'complete', step: 0 });
  });

  it('준비부터 단계 진행과 완료까지 저장한다', async () => {
    await prepareOnboarding();
    expect(await getOnboardingState()).toEqual({ status: 'pending', step: 0 });

    await startOnboarding();
    await setOnboardingStep(2);
    expect(await getOnboardingState()).toEqual({ status: 'touring', step: 2 });

    await completeOnboarding();
    expect(await getOnboardingState()).toEqual({ status: 'complete', step: 0 });
  });

  it('손상된 저장값과 잘못된 단계는 안전한 기본값으로 정리한다', async () => {
    await chrome.storage.local.set({ 'orbit:onboarding': { status: 'unknown', step: -2 } });
    expect(await getOnboardingState()).toEqual({ status: 'complete', step: 0 });

    await setOnboardingStep(Number.NaN);
    expect(await getOnboardingState()).toEqual({ status: 'touring', step: 0 });
  });

  it('최초 설치에서만 안내 탭을 연다', async () => {
    const create = vi.spyOn(chrome.tabs, 'create').mockResolvedValue(undefined);

    expect(await openOnboardingForInstall('update')).toBe(false);
    expect(create).not.toHaveBeenCalled();

    expect(await openOnboardingForInstall('install')).toBe(true);
    expect(create).toHaveBeenCalledWith({
      url: chrome.runtime.getURL('newtab.html?onboarding=1'),
    });
    expect(await getOnboardingState()).toEqual({ status: 'pending', step: 0 });
  });
});
