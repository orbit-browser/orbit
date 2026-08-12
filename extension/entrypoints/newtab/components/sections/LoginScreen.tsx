import { useAuth } from '../../../../lib/useAuth';

/**
 * 새 탭의 로그인 화면.
 *
 * 새 탭은 브라우저를 열 때마다 보이는 자리라 로그인 요구가 과하게 느껴지지 않도록
 * 히어로 그래픽과 같은 구성을 유지하고 버튼 하나만 둔다.
 */
export function LoginScreen() {
  const { loading, signingIn, error, signIn } = useAuth();

  return (
    <div className="login-screen">
      <div className="login-screen__glow" aria-hidden="true" />
      <section className="login-screen__card" aria-labelledby="login-title">
        <div className="login-screen__brand">
          <img className="login-screen__mark" src="/orbit-mark.png" alt="" />
          <span>Orbit</span>
        </div>

        <h1 id="login-title" className="login-screen__title">
          탐색을 멈춘 곳에서 이어가세요
        </h1>
        <p className="login-screen__desc">
          방문 기록을 세션으로 정리하고
          <br />
          필요할 때 다시 찾아보세요.
        </p>

        <button
          type="button"
          className="login-screen__button"
          onClick={() => void signIn()}
          disabled={loading || signingIn}
        >
          <span className="login-screen__google" aria-hidden="true">G</span>
          {signingIn ? '로그인 중…' : 'Google 계정으로 계속'}
        </button>

        <p className="login-screen__note">
          로그인 후 탐색 기록 수집 여부를 직접 선택할 수 있어요.
        </p>

        {error && (
          <p className="login-screen__error" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
