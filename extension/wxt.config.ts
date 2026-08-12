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

/**
 * 확장 ID 를 고정하는 공개키(SPKI DER 의 base64).
 *
 * 이 값이 없으면 확장 ID 가 설치 경로에서 유도돼 `pnpm dev`(.output/chrome-mv3-dev)와
 * `pnpm build`(.output/chrome-mv3), 그리고 팀원 머신이 각각 다른 ID 를 갖는다.
 * 구글 OAuth 클라이언트에는 Item ID 를 하나만 등록하므로 그 중 하나에서만 로그인이 된다.
 *
 * client_id 와 달리 **환경마다 달라지면 안 되는 값**이라 .env 가 아니라 여기에 커밋한다.
 * 공개키라 비밀이 아니다 — 짝이 되는 개인키는 `.keys/`(gitignore) 에 있다.
 * 확장 ID: aghgamoeifieijjckhpfkmhiibacnhml
 */
const EXTENSION_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAreFmM8g/hv09oWmMqhsmnZEWuK2TmMdt3+Tl54wHRKe4v/FpWbjuabQn1HTZV4mHdXh89IW0+//PdjrZC1BQClbLx09PVQB9yCps0hPqzgFimmG9BqIIg8/fxAZKHYC5Vkalf4YEZawdtLBf7Q9+KTeZxK9KtFAXqlWrzIqJpsH64SvaleXVpXyvrdezF+1v4CnsR3R2p6GeQw56nWOglOaX8dvNRwRQr6ZdxLuTuHKVc08aDNogwZl+/4tcmrIov8i22V2Ia5jjbSfyrJatjZVsBRPRRj1KN4ARVR1ubLi7PYj5CQN5WZmXH5CjAs5Ff0y+W5wNaIue5RjjPlB5PwIDAQAB';

// https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
    // chrome-extension:// 페이지에서는 crossorigin modulepreload 의 fetch 모드가 실제 모듈
    // 요청과 어긋나(cross-world resource mismatch) 크롬이 preload 를 버리고 다시 받는다.
    // 동작에는 문제가 없지만 콘솔 경고만 남으므로 preload 태그를 아예 만들지 않는다.
    build: { modulePreload: false },
  }),
  manifest: {
    name: 'Orbit',
    description: '탐색의 흐름을 기억하고, 원하는 순간에 복원하는 AI Browser Agent',
    // dev·build·팀원 머신에서 확장 ID 를 동일하게 유지한다(위 EXTENSION_KEY 주석 참고).
    key: EXTENSION_KEY,
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
