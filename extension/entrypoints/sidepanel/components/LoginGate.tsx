import type { ReactNode } from 'react';
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
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-orbit-bg px-6 text-center">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute h-72 w-72 rounded-full bg-orbit-primary/10 blur-3xl"
      />
      <section className="relative flex w-full max-w-[320px] flex-col items-center">
        <div className="flex flex-col items-center gap-2 text-xs font-bold text-orbit-text">
          <img src="/orbit-mark.png" alt="" className="h-13 w-auto" />
          <span>Orbit</span>
        </div>

        <h1 className="mt-6 text-lg font-bold tracking-[-0.03em] text-orbit-text">
          Orbit에 로그인
        </h1>
        <p className="mt-2 text-xs leading-relaxed text-orbit-muted">
          방문 기록을 세션으로 정리하고
          <br />
          멈춘 탐색을 다시 이어가세요.
        </p>

        <button
          type="button"
          onClick={() => void signIn()}
          disabled={signingIn}
          className="mt-7 flex h-11 w-full cursor-pointer items-center justify-center gap-2.5 rounded-full border border-black/10 bg-white text-sm font-semibold text-[#2b2521] shadow-orbit-raised transition hover:-translate-y-px hover:shadow-orbit-card disabled:cursor-default disabled:opacity-50"
        >
          <span
            aria-hidden="true"
            className="grid h-5 w-5 place-items-center rounded-full border border-black/10 text-[11px] font-bold"
          >
            G
          </span>
          {signingIn ? '로그인 중…' : 'Google 계정으로 계속'}
        </button>

        <p className="mt-4 text-[11px] leading-relaxed text-orbit-muted">
          로그인 후 탐색 기록 수집 여부를 직접 선택할 수 있어요.
        </p>

        {error && (
          <p className="mt-3 max-w-[260px] text-xs leading-relaxed text-orbit-danger" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
