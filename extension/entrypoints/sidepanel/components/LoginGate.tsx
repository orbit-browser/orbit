import type { ReactNode } from 'react';
import { LogIn } from 'lucide-react';
import { useAuth } from '../../../lib/useAuth';

/**
 * 로그인 전에는 아무 화면도 보여주지 않는다.
 *
 * 로그인을 필수로 둔 이유는 데이터 주인을 항상 명확히 하기 위해서다 —
 * 비로그인 상태로 수집·동기화가 돌면 그 기록이 누구 것인지 정할 수 없다.
 */
export function LoginGate({ children }: { children: ReactNode }) {
  const { session, loading, signingIn, error, signIn } = useAuth();

  // 저장된 세션을 읽는 동안 로그인 화면을 깜빡이지 않는다.
  if (loading) {
    return <div className="h-full w-full bg-orbit-bg" />;
  }

  if (session) return <>{children}</>;

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-5 bg-orbit-bg px-8 text-center">
      <img src="/orbit-mark.png" alt="" className="h-12 w-auto" />

      <div className="space-y-1.5">
        <h1 className="text-base font-bold text-orbit-text">Orbit 시작하기</h1>
        <p className="text-xs leading-relaxed text-orbit-muted">
          구글 계정으로 로그인하면 탐색 기록이 내 계정에 안전하게 쌓여요.
        </p>
      </div>

      <button
        type="button"
        onClick={() => void signIn()}
        disabled={signingIn}
        className="flex items-center gap-2 rounded-full bg-orbit-text px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50 cursor-pointer"
      >
        <LogIn size={15} />
        {signingIn ? '로그인 중…' : 'Google로 계속하기'}
      </button>

      {error && (
        <p className="max-w-[260px] text-xs leading-relaxed text-orbit-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
