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
    permissions: ['tabs', 'storage', 'sidePanel', 'bookmarks'],
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
