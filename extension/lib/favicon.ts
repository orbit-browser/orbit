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
 *
 * 조회는 **출처(origin) 단위**로 한다. 크롬 파비콘 DB 는 페이지 URL 로 색인돼 있어
 * 깊은 경로(`/orbit-browser/orbit/branches`)는 항목이 없을 수 있고, 그때 `_favicon/` 은
 * 오류 대신 200 에 기본 아이콘을 실어 보낸다 — `<img onError>` 가 안 터지므로 호출측
 * 폴백도 동작하지 않는다. 같은 출처의 루트로 물으면 적중률이 올라간다.
 * 페이지마다 다른 파비콘을 쓰는 사이트는 드물어 잃는 것이 거의 없다.
 */
export function faviconUrl(pageUrl: string, size = 32): string {
  if (!pageUrl) return '';
  try {
    const origin = new URL(pageUrl).origin;
    const target = new URL(chrome.runtime.getURL('/_favicon/'));
    target.searchParams.set('pageUrl', `${origin}/`);
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

/** 파비콘을 못 그렸을 때 대신 쓸 한 글자 — 빈 원보다 사이트 구분이 된다. */
export function faviconLetter(pageUrlOrDomain: string): string {
  const source = pageUrlOrDomain.trim();
  if (!source) return '?';
  let host = source;
  try {
    host = new URL(source).hostname;
  } catch {
    // 도메인 문자열이 그대로 들어온 경우
  }
  const label = host.replace(/^www\./i, '');
  return (label.charAt(0) || '?').toUpperCase();
}
