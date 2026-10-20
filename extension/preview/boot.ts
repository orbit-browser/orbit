/**
 * 미리보기 페이지가 앱보다 먼저 실행하는 준비 단계: chrome 대역, 백엔드 대역, 로그인·온보딩 상태.
 * 앱 모듈이 평가되기 전에 끝나야 하므로 각 페이지의 진입점에서 가장 먼저 import 한다.
 */
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
localStorage.setItem('orbit-preview:storage:local', JSON.stringify(local));
