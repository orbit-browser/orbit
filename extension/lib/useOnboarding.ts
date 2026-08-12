import { useEffect, useState } from 'react';
import {
  DEFAULT_ONBOARDING_STATE,
  getOnboardingState,
  onOnboardingChange,
  type OnboardingState,
} from './onboarding';

export function useOnboarding(): { state: OnboardingState; loading: boolean } {
  const [state, setState] = useState(DEFAULT_ONBOARDING_STATE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let changed = false;
    void getOnboardingState()
      .then((saved) => {
        if (!cancelled && !changed) setState(saved);
      })
      .catch(() => {
        if (!cancelled && !changed) setState(DEFAULT_ONBOARDING_STATE);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    const unsubscribe = onOnboardingChange((next) => {
      changed = true;
      setState(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { state, loading };
}
