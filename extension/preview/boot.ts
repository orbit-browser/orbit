/**
 * 미리보기 페이지가 앱보다 먼저 실행하는 준비 단계: chrome 대역, 백엔드 대역, 로그인·온보딩 상태.
 * 앱 모듈이 평가되기 전에 끝나야 하므로 각 페이지의 진입점에서 가장 먼저 import 한다.
 */
import { onSessionChange } from '../lib/auth';
import { applyAccountConsent } from '../lib/sync/triggers';
import { installApiMock, loadDb } from './api-mock';
import { installChromeShim } from './chrome-shim';

installChromeShim();
installApiMock();

const db = loadDb();
const me = db.users.find((user) => user.user_id === db.me)!;

// 로그인한 상태로 시작한다. 시드는 비어 있을 때만 — 미리보기 안에서 바꾼 설정(테마·범위)은 유지한다.
const local = JSON.parse(localStorage.getItem('orbit-preview:storage:local') ?? '{}') as Record<string, unknown>;
local['orbit:auth'] ??= {
  token: 'preview-token',
  expiresAt: '2099-01-01T00:00:00Z',
  user: { id: me.user_id, email: me.email, name: me.name, picture: me.picture },
};
local['orbit:onboarding'] ??= { status: 'complete', step: 0 };

// 주소로 테마와 범위를 고정할 수 있다(스크린샷을 같은 조건으로 찍기 위해). 예: ?theme=dark&scope=w-capstone
const params = new URLSearchParams(location.search);
const theme = params.get('theme');
const scope = params.get('scope');
if (theme || scope !== null) {
  const settings = (local['orbit:settings'] ?? {}) as Record<string, unknown>;
  if (theme === 'light' || theme === 'dark' || theme === 'system') settings.theme = theme;
  if (scope !== null) settings.activeWorkspaceId = scope || null;
  local['orbit:settings'] = settings;
}
localStorage.setItem('orbit-preview:storage:local', JSON.stringify(local));

// 미리보기에는 서비스 워커가 없다. 계정이 바뀌면 SW가 하던 대로 수집 스위치를 새 계정의 동의로 맞춘다.
onSessionChange((session, previous) => {
  if (session?.user.id === previous?.user.id) return;
  void applyAccountConsent(previous?.user.id ?? session?.user.id);
});
