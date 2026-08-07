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
    // 새 탭 홈이 쓰는 권한:
    //   search   — 검색창이 사용자가 크롬에 설정한 기본 검색엔진을 그대로 쓴다.
    //   topSites — 바로가기의 초기 목록(자주 방문한 사이트). 사용자가 편집하면 더 읽지 않는다.
    //   favicon  — 바로가기 아이콘을 확장 내장 파비콘으로 그린다(외부 요청 없음).
    //   bookmarks — 사용자가 선택한 열린 탭만 Chrome 기본 북마크에 추가한다.
    permissions: [
      'tabs',
      'storage',
      'sidePanel',
      'webNavigation',
      'alarms',
      'idle',
      'search',
      'topSites',
      'favicon',
      'bookmarks',
    ],
    // TODO: 배포 URL 확정 시 프로덕션 백엔드 도메인 추가
    host_permissions: ['http://localhost/*', 'http://127.0.0.1/*'],
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+O' },
      },
    },
    // 배경이 구워진 이미지는 크롬 사이드패널 헤더·툴바에서 주변과 분리돼 보인다.
    // 알파 배경 마크를 크기별로 제공한다.
    icons: {
      '16': '/orbit-mark-16.png',
      '32': '/orbit-mark-32.png',
      '48': '/orbit-mark-48.png',
      '128': '/orbit-mark-128.png',
    },
    action: {
      default_title: 'Orbit 사이드패널 열기',
      default_icon: {
        '16': '/orbit-mark-16.png',
        '32': '/orbit-mark-32.png',
        '48': '/orbit-mark-48.png',
        '128': '/orbit-mark-128.png',
      },
    },
  },
});
