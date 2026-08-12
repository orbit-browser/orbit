import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../../lib/query-client';
// 시안은 Phosphor 를 CDN <script> 로 불러왔다. MV3 CSP 에서 막히므로 로컬 번들로 바꿨다.
import './styles/phosphor.css';
import './styles/index.css';
import App from './App';
import { OrbitAtlasPage } from './pages/OrbitAtlasPage';
import { getRoute } from './lib/navigation';
import { LoginScreen } from './components/sections/LoginScreen';
import { useAuth } from '../../lib/useAuth';
import { useOrbitSettings } from './hooks/useOrbitSettings';
import { useTheme } from './hooks/useTheme';

/**
 * 홈 ↔ 아틀라스 두 화면을 해시 라우트로 전환한다 (시안 `src/main.tsx` 와 같은 구조).
 * 로그인 전에는 두 화면 모두 열지 않는다 — 데이터가 누구 것인지 정해진 뒤에 보여준다.
 */
function Root() {
  const { settings } = useOrbitSettings();
  const [route, setRoute] = useState(getRoute);
  const { session, loading } = useAuth();

  useEffect(() => {
    const onPop = () => setRoute(getRoute());
    window.addEventListener('popstate', onPop);
    // 주소창에서 해시만 바꾸는 경우 popstate 가 오지 않는 브라우저가 있어 함께 듣는다.
    window.addEventListener('hashchange', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onPop);
    };
  }, []);

  // 모양은 로그인 여부와 무관하게 첫 화면부터 적용한다.
  useTheme(settings.theme);

  // 저장된 세션을 읽는 동안 로그인 화면을 깜빡이지 않는다.
  if (loading) return <div className="app-container" />;
  if (!session) {
    return (
      <div className="app-container">
        <LoginScreen />
      </div>
    );
  }

  return route === 'orbit-atlas' ? <OrbitAtlasPage /> : <App />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Root />
    </QueryClientProvider>
  </React.StrictMode>,
);
