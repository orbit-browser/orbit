export type OnboardingStatus = 'pending' | 'touring' | 'complete';

export interface OnboardingState {
  status: OnboardingStatus;
  step: number;
}

export const ONBOARDING_STORAGE_KEY = 'orbit:onboarding';
export const DEFAULT_ONBOARDING_STATE: OnboardingState = { status: 'complete', step: 0 };

function normalizeState(value: unknown): OnboardingState {
  if (!value || typeof value !== 'object') return DEFAULT_ONBOARDING_STATE;
  const saved = value as Partial<OnboardingState>;
  if (!['pending', 'touring', 'complete'].includes(saved.status ?? '')) {
    return DEFAULT_ONBOARDING_STATE;
  }
  return {
    status: saved.status as OnboardingStatus,
    step: Number.isInteger(saved.step) && Number(saved.step) >= 0 ? Number(saved.step) : 0,
  };
}

export async function getOnboardingState(): Promise<OnboardingState> {
  const stored = await chrome.storage.local.get(ONBOARDING_STORAGE_KEY);
  return normalizeState(stored[ONBOARDING_STORAGE_KEY]);
}

async function saveOnboardingState(state: OnboardingState): Promise<void> {
  await chrome.storage.local.set({ [ONBOARDING_STORAGE_KEY]: state });
}

export async function prepareOnboarding(): Promise<void> {
  await saveOnboardingState({ status: 'pending', step: 0 });
}

export async function startOnboarding(): Promise<void> {
  const current = await getOnboardingState();
  await saveOnboardingState({ status: 'touring', step: current.step });
}

export async function setOnboardingStep(step: number): Promise<void> {
  const safeStep = Number.isFinite(step) ? Math.max(0, Math.floor(step)) : 0;
  await saveOnboardingState({ status: 'touring', step: safeStep });
}

export async function completeOnboarding(): Promise<void> {
  await saveOnboardingState({ status: 'complete', step: 0 });
}

export function onOnboardingChange(listener: (state: OnboardingState) => void): () => void {
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ) => {
    if (areaName !== 'local' || !(ONBOARDING_STORAGE_KEY in changes)) return;
    listener(normalizeState(changes[ONBOARDING_STORAGE_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

/** 기존 사용자에게는 보이지 않도록 최초 설치에서만 온보딩을 준비한다. */
export async function openOnboardingForInstall(reason: string): Promise<boolean> {
  if (reason !== 'install') return false;
  await prepareOnboarding();
  await chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html?onboarding=1') });
  return true;
}
