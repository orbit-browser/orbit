import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'Orbit',
    description: '탐색의 흐름을 기억하고, 원하는 순간에 복원하는 AI Browser Agent',
    permissions: ['tabs', 'storage', 'sidePanel', 'webNavigation', 'alarms', 'idle'],
    // TODO: 배포 URL 확정 시 프로덕션 백엔드 도메인 추가
    host_permissions: ['http://localhost/*', 'http://127.0.0.1/*'],
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+O' },
      },
    },
    icons: {
      '128': '/orbit_icon.png',
    },
    action: {
      default_title: 'Orbit 사이드패널 열기',
      default_icon: {
        '128': '/orbit_icon.png',
      },
    },
  },
});
