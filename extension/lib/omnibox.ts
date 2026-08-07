/**
 * 주소창 입력 해석 — 새 탭 홈의 검색창이 브라우저 주소창과 같게 동작하도록.
 *
 * 결과 실행(이동 / 검색)은 호출부가 담당한다. 이 모듈은 순수 함수만 둔다.
 */

export type OmniboxIntent =
  | { kind: 'navigate'; url: string }
  | { kind: 'search'; query: string };

/** 사용자가 직접 스킴을 적었을 때 이동을 허용하는 목록. 나머지는 전부 검색으로 강등한다. */
const NAVIGABLE_SCHEMES = new Set(['http:', 'https:', 'file:']);

/**
 * `scheme:` 로 시작하는지 — `//` 유무와 무관하게 판별한다(`mailto:`, `javascript:` 포함).
 *
 * 콜론 뒤가 숫자면 스킴이 아니라 포트로 본다. 이게 없으면 `localhost:5173` 의
 * `localhost:` 가 스킴으로 잡혀 검색으로 새어 나간다.
 */
const SCHEME_PREFIX = /^[a-z][a-z0-9+.-]*:(?!\d)/i;

/** `localhost` 또는 `localhost:3000` 처럼 TLD 없이도 주소로 봐야 하는 호스트. */
const LOCAL_HOST = /^localhost(:\d{1,5})?(\/.*)?$/i;

/** IPv4 + 선택적 포트/경로. */
const IPV4_HOST = /^\d{1,3}(\.\d{1,3}){3}(:\d{1,5})?(\/.*)?$/;

/**
 * `example.com`, `sub.example.co.kr/path?q=1` 처럼 스킴 없이 적은 도메인.
 * 마지막 점 뒤가 2자 이상 알파벳이어야 한다 — `1.5`, `버전 2.0` 같은 입력이
 * 주소로 새지 않게 하는 최소 방어선이다.
 */
const BARE_DOMAIN = /^[^\s/?#@]+\.[a-z]{2,}(:\d{1,5})?([/?#].*)?$/i;

/**
 * 브라우저 주소창과 같은 규칙으로 입력을 해석한다.
 *
 * - http/https/file 스킴이 명시되면 그대로 이동한다.
 * - `localhost[:port]`, IPv4, "점 + TLD" 형태의 공백 없는 문자열은 https 를 붙여 이동한다.
 * - 그 밖의 모든 입력(공백 포함, 점 없음, 허용되지 않은 스킴)은 검색으로 처리한다.
 *
 * `javascript:` · `data:` · `chrome:` 등을 검색으로 강등하는 것은 의도된 경계 검증이다.
 * 홈 입력만으로 특권 스킴이 실행되면 안 된다.
 */
export function parseOmniboxInput(raw: string): OmniboxIntent {
  const input = raw.trim();
  if (!input) return { kind: 'search', query: '' };

  if (SCHEME_PREFIX.test(input)) {
    const parsed = safeParseUrl(input);
    if (parsed && NAVIGABLE_SCHEMES.has(parsed.protocol)) {
      return { kind: 'navigate', url: parsed.href };
    }
    return { kind: 'search', query: input };
  }

  if (LOCAL_HOST.test(input) || IPV4_HOST.test(input) || BARE_DOMAIN.test(input)) {
    // 로컬 주소는 http 로 붙인다. 크롬 주소창도 localhost 를 HTTPS-First 대상에서 빼는데,
    // https 를 강제하면 개발 서버(`localhost:8000`)가 그냥 연결 실패로 보인다.
    const scheme = isLocalAddress(input) ? 'http' : 'https';
    const parsed = safeParseUrl(`${scheme}://${input}`);
    if (parsed) return { kind: 'navigate', url: parsed.href };
  }

  return { kind: 'search', query: input };
}

/** 루프백 주소인지 — 스킴을 붙이기 전 상태의 입력을 받는다. */
function isLocalAddress(input: string): boolean {
  return LOCAL_HOST.test(input) || /^127\./.test(input);
}

function safeParseUrl(candidate: string): URL | null {
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}
