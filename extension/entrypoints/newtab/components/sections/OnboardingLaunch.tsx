import { useEffect, useState } from 'react';
import { PanelRightOpen } from 'lucide-react';
import { startOnboarding } from '../../../../lib/onboarding';
import { useOnboarding } from '../../../../lib/useOnboarding';
import { replaceWithAtlas } from '../../lib/navigation';

export function OnboardingLaunch() {
  const [opening, setOpening] = useState(false);
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [windowId, setWindowId] = useState<number | null>(null);
  const { state, loading } = useOnboarding();

  useEffect(() => {
    void chrome.windows.getCurrent()
      .then((current) => setWindowId(current.id ?? null))
      .catch(() => setError('현재 브라우저 창을 확인하지 못했어요. 새 탭에서 다시 시도해 주세요.'));
  }, []);

  /*
    투어는 사이드패널에서 끝나고 이 탭은 안내 화면에 멈춰 있다.
    완료·건너뛰기가 저장되는 순간(`orbit:onboarding` 변경) 이 탭을 대시보드로 넘겨
    첫 실행이 화면 없이 끊기지 않게 한다. 사이드패널은 탭이 아니라 이 탭이 계속 활성이므로
    탭을 따로 활성화하지 않아도 사용자는 전환을 바로 본다.
  */
  useEffect(() => {
    if (loading || state.status !== 'complete') return;
    replaceWithAtlas();
  }, [loading, state.status]);

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
