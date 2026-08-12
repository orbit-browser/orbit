import { useEffect, useState } from 'react';
import { PanelRightOpen } from 'lucide-react';
import { startOnboarding } from '../../../../lib/onboarding';

export function OnboardingLaunch() {
  const [opening, setOpening] = useState(false);
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [windowId, setWindowId] = useState<number | null>(null);

  useEffect(() => {
    void chrome.windows.getCurrent()
      .then((current) => setWindowId(current.id ?? null))
      .catch(() => setError('현재 브라우저 창을 확인하지 못했어요. 새 탭에서 다시 시도해 주세요.'));
  }, []);

  async function openSidePanel() {
    setOpening(true);
    setError(null);

    if (windowId == null) {
      setOpening(false);
      setError('현재 브라우저 창을 확인하지 못했어요. 다시 시도해 주세요.');
      return;
    }
    // sidePanel.open은 사용자 제스처가 필요하므로 두 Promise를 첫 await 전에 시작한다.
    const stateRequest = startOnboarding();
    const panelRequest = chrome.sidePanel.open({ windowId });

    try {
      await Promise.all([stateRequest, panelRequest]);
      setOpened(true);
    } catch {
      setError('사이드패널을 열지 못했어요. 툴바의 Orbit 아이콘을 눌러 계속해 주세요.');
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-screen__glow" aria-hidden="true" />
      <section className="login-screen__card" aria-labelledby="onboarding-title">
        <div className="login-screen__brand">
          <img className="login-screen__mark" src="/orbit-mark.png" alt="" />
          <span>Orbit</span>
        </div>

        <h1 id="onboarding-title" className="login-screen__title">
          이제 탐색을 기억할 준비가 됐어요
        </h1>
        <p className="login-screen__desc">
          사이드패널에서 수집을 켜고
          <br />
          Orbit의 핵심 기능을 둘러보세요.
        </p>

        <button
          type="button"
          className="login-screen__button"
          onClick={() => void openSidePanel()}
          disabled={opening || opened || windowId == null}
        >
          <PanelRightOpen size={17} />
          {opening ? '사이드패널 여는 중…' : opened ? '사이드패널에서 계속하세요' : '사이드패널에서 시작하기'}
        </button>

        <p className="login-screen__note">안내는 언제든 건너뛸 수 있어요.</p>
        {error && <p className="login-screen__error" role="alert">{error}</p>}
      </section>
    </div>
  );
}
