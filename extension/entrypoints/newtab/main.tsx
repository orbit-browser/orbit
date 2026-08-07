import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
// 시안은 Phosphor 를 CDN <script> 로 불러왔다. MV3 CSP 에서 막히므로 로컬 번들로 바꿨다.
import './styles/phosphor.css';
import './styles/index.css';
import App from './App';
import { OrbitAtlasPage } from './pages/OrbitAtlasPage';
import { getRoute } from './lib/navigation';

/** 홈 ↔ 아틀라스 두 화면을 해시 라우트로 전환한다 (시안 `src/main.tsx` 와 같은 구조). */
function Root() {
  const [route, setRoute] = useState(getRoute);

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

  return route === 'orbit-atlas' ? <OrbitAtlasPage /> : <App />;
}

// 홈은 백엔드를 호출하지 않으므로 QueryClientProvider 를 두지 않는다.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
