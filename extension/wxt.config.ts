import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

/**
 * manifest 는 Vite 의 import.meta.env 를 못 쓰므로 .env 를 직접 읽는다.
 * 값이 없으면 빈 문자열로 두고 빌드는 통과시킨다 — 로그인만 동작하지 않는다.
 * (OAuth 클라이언트 ID 는 시크릿이 아니지만, 환경마다 달라 커밋하지 않는다.)
 */
function envValue(key: string): string {
  try {
    const text = readFileSync(resolve(__dirname, '.env'), 'utf-8');
    for (const line of text.split('\n')) {
      const [name, ...rest] = line.split('=');
      if (name?.trim() === key) return rest.join('=').trim();
    }
  } catch {
    // .env 없음 — 신규 클론 등
  }
  return '';
}

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
      // identity — 구글 로그인. 크롬 프로필 계정의 access token 을 받는다.
      'identity',
    ],
    // 구글 OAuth. client_id 는 extension/.env 의 VITE_GOOGLE_CLIENT_ID 에서 읽는다.
    // Google Cloud Console 에서 "Chrome 확장 프로그램" 유형으로 발급받고,
    // 발급 시 이 확장의 ID(chrome://extensions)를 등록해야 한다.
    oauth2: {
      client_id: envValue('VITE_GOOGLE_CLIENT_ID'),
      scopes: ['openid', 'email', 'profile'],
    },
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
