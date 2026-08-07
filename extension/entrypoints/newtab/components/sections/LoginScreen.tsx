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
      <img className="login-screen__mark" src="/orbit-mark.png" alt="" />

      <h1 className="login-screen__title">Orbit</h1>
      <p className="login-screen__desc">
        구글 계정으로 로그인하면 탐색 기록이 내 계정에 쌓이고,
        <br />
        어디서 멈췄는지 다시 이어갈 수 있어요.
      </p>

      <button
        type="button"
        className="btn-primary login-screen__button"
        onClick={() => void signIn()}
        disabled={loading || signingIn}
      >
        {signingIn ? '로그인 중…' : 'Google로 계속하기'}
      </button>

      {error && (
        <p className="login-screen__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
