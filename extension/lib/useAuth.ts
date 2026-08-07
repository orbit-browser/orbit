import { useCallback, useEffect, useState } from 'react';
import {
  getSession,
  onSessionChange,
  signIn as signInRequest,
  signOut as signOutRequest,
  type AuthSession,
} from './auth';

export interface UseAuth {
  session: AuthSession | null;
  /** 저장된 세션을 아직 읽는 중 — 로그인 화면을 깜빡이며 보여주지 않기 위해 구분한다. */
  loading: boolean;
  signingIn: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

/**
 * 사이드패널과 새 탭이 함께 쓰는 로그인 상태 훅.
 *
 * 저장소 변경을 구독하므로 한쪽에서 로그인/로그아웃하면 다른 쪽도 따라 바뀐다.
 */
export function useAuth(): UseAuth {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getSession().then((current) => {
      if (cancelled) return;
      setSession(current);
      setLoading(false);
    });
    const unsubscribe = onSessionChange((next) => setSession(next));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const signIn = useCallback(async () => {
    setError(null);
    setSigningIn(true);
    try {
      const result = await signInRequest();
      setSession(result.session);
    } catch (err) {
      // 실패를 삼키면 버튼만 깜빡이고 아무 일도 없는 것처럼 보인다.
      setError(err instanceof Error ? err.message : '로그인에 실패했어요');
    } finally {
      setSigningIn(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    setError(null);
    try {
      await signOutRequest();
      setSession(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그아웃에 실패했어요');
    }
  }, []);

  return { session, loading, signingIn, error, signIn, signOut };
}
