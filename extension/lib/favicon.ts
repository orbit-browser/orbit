/**
 * 파비콘 URL — 확장 내장 `_favicon/` 을 쓴다.
 *
 * 크롬이 이미 방문한 사이트의 파비콘을 캐시하고 있으므로 **네트워크 요청이 없고**,
 * 외부 파비콘 서비스(google s2 등)에 방문 기록을 흘리지도 않는다.
 * `favicon` 권한이 필요하다(manifest 에 이미 있음).
 *
 * 저장된 `favIconUrl` 에만 의존하면 안 되는 이유:
 * Auto Session 은 방문 이벤트로 만들어져 탭 파비콘을 들고 있지 않을 때가 많고,
 * 스냅샷 세션도 시간이 지나면 원본 파비콘 URL 이 404 가 된다.
 */

/**
 * 페이지 URL 로 파비콘 주소를 만든다.
 * 확장 컨텍스트 밖(테스트·미리보기)에서는 빈 문자열 — 호출측이 폴백을 그린다.
 */
export function faviconUrl(pageUrl: string, size = 32): string {
  if (!pageUrl) return '';
  try {
    const target = new URL(chrome.runtime.getURL('/_favicon/'));
    target.searchParams.set('pageUrl', pageUrl);
    target.searchParams.set('size', String(size));
    return target.toString();
  } catch {
    return '';
  }
}

/** 도메인만 있을 때 — 파비콘 조회에는 출처(origin)만 있으면 된다. */
export function faviconUrlForDomain(domain: string, size = 32): string {
  if (!domain) return '';
  const host = domain.trim().toLowerCase();
  return faviconUrl(`https://${host.replace(/^https?:\/\//, '')}/`, size);
}
