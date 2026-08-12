import { useEffect } from 'react';
import type { OrbitTheme } from '../../../lib/settings';

/**
 * 설정한 모양을 문서에 적용한다.
 *
 * `html[data-theme='dark']` 하나로 팔레트가 통째로 갈리므로(styles/index.css, styles/atlas.css)
 * 화면마다 따로 분기하지 않는다. `system` 이면 OS 설정을 따라가고, 사용자가 OS 쪽을 바꾸면
 * 새로고침 없이 같이 바뀐다.
 */
export function useTheme(theme: OrbitTheme) {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };

    apply();
    if (theme !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
}
