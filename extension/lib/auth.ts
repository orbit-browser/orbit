/**
 * 구글 로그인.
 *
 * `chrome.identity.getAuthToken` 으로 크롬 프로필 계정의 access token 을 받아
 * 백엔드(`POST /auth/google`)에 넘기면, 백엔드가 그 토큰이 우리 OAuth 클라이언트에
 * 발급된 것인지 확인한 뒤 자체 세션 토큰(JWT)을 돌려준다.
 * 이후 모든 API 호출은 그 세션 토큰을 쓴다(`lib/api.ts`).
 *
 * 저장소는 `chrome.storage.local` — 사이드패널·새 탭·서비스워커가 함께 읽어야 하므로
 * `lib/settings.ts` 와 같은 방식을 쓴다.
 */

const STORAGE_KEY = 'orbit:auth';

const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
}

export interface AuthSession {
  token: string;
  /** ISO 8601. 만료 판단은 서버가 최종 결정하지만, 만료된 토큰으로 굳이 호출하지 않는다. */
  expiresAt: string;
  user: AuthUser;
}

export class AuthRequiredError extends Error {
  constructor(message = '로그인이 필요합니다') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

// ── 저장소 ────────────────────────────────────────────────────────────

export async function getSession(): Promise<AuthSession | null> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const saved = stored[STORAGE_KEY] as AuthSession | undefined;
    if (!saved?.token) return null;
    if (new Date(saved.expiresAt).getTime() <= Date.now()) {
      // 만료된 토큰은 들고 있어봐야 401만 부른다.
      await clearSession();
      return null;
    }
    return saved;
  } catch (err) {
    console.error('[Orbit] 로그인 정보 조회 실패', err);
    return null;
  }
}

export async function getToken(): Promise<string | null> {
  return (await getSession())?.token ?? null;
}

async function saveSession(session: AuthSession): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: session });
}

export async function clearSession(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}

/** 로그인 상태 변화 구독 — 다른 컨텍스트(사이드패널↔새 탭)의 로그인/로그아웃을 반영한다. */
export function onSessionChange(listener: (session: AuthSession | null) => void): () => void {
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area !== 'local' || !(STORAGE_KEY in changes)) return;
    listener((changes[STORAGE_KEY].newValue as AuthSession | undefined) ?? null);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

// ── 로그인 / 로그아웃 ─────────────────────────────────────────────────

/** 크롬에서 구글 access token 을 받는다. 사용자가 취소하면 null. */
function requestGoogleToken(interactive: boolean): Promise<string | null> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        // 비대화형 호출에서 계정이 없을 때도 여기로 온다 — 취소와 구분하지 않고 null.
        if (!interactive) return resolve(null);
        return reject(new Error(error.message ?? '구글 인증에 실패했습니다'));
      }
      // 크롬 버전에 따라 문자열 또는 { token } 객체를 준다.
      const token = typeof result === 'string' ? result : result?.token;
      resolve(token ?? null);
    });
  });
}

export interface SignInResult {
  session: AuthSession;
  /** 이번 로그인으로 계정이 새로 만들어졌는지 (가입) */
  isNewUser: boolean;
  /** 인증 도입 전 쌓인 로컬 데이터를 넘겨받은 행 수 */
  claimedLegacyRows: number;
}

/**
 * 구글 계정으로 로그인한다. 계정이 없으면 그 자리에서 가입된다.
 *
 * @throws {Error} 사용자 취소, 구글 인증 실패, 백엔드 거부
 */
export async function signIn(): Promise<SignInResult> {
  const googleToken = await requestGoogleToken(true);
  if (!googleToken) throw new Error('로그인이 취소되었습니다');

  let response: Response;
  try {
    response = await fetch(`${BASE}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: googleToken }),
    });
  } catch {
    throw new Error('백엔드에 연결하지 못했습니다. 서버가 켜져 있는지 확인해 주세요.');
  }

  if (!response.ok) {
    // 백엔드가 거부한 토큰은 크롬 캐시에서도 지운다 — 안 지우면 같은 토큰으로 계속 재시도한다.
    await removeCachedToken(googleToken);
    const detail = await extractDetail(response);
    throw new Error(detail ?? `로그인에 실패했습니다 (${response.status})`);
  }

  const body = await response.json();
  const session: AuthSession = {
    token: body.access_token,
    expiresAt: body.expires_at,
    user: {
      id: body.user.id,
      email: body.user.email,
      name: body.user.name ?? null,
      picture: body.user.picture ?? null,
    },
  };
  await saveSession(session);

  return {
    session,
    isNewUser: Boolean(body.is_new_user),
    claimedLegacyRows: body.claimed_legacy_rows ?? 0,
  };
}

/**
 * 로그아웃 — 저장된 세션과 크롬의 구글 토큰 캐시를 모두 비운다.
 *
 * 캐시를 남기면 다음 로그인에서 계정 선택 없이 같은 계정으로 조용히 다시 들어간다.
 */
export async function signOut(): Promise<void> {
  const googleToken = await requestGoogleToken(false).catch(() => null);
  if (googleToken) await removeCachedToken(googleToken);
  await clearSession();
}

async function removeCachedToken(token: string): Promise<void> {
  try {
    await chrome.identity.removeCachedAuthToken({ token });
  } catch (err) {
    console.error('[Orbit] 구글 토큰 캐시 제거 실패', err);
  }
}

async function extractDetail(response: Response): Promise<string | null> {
  try {
    const body = await response.json();
    return typeof body?.detail === 'string' ? body.detail : null;
  } catch {
    return null;
  }
}
