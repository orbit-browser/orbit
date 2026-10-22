/**
 * 페이지 화면(카드 썸네일), 키는 페이지 URL.
 *
 * 확장은 아직 탭 화면을 모으지 않는다(캡처 권한·저장 방식은 대표 결정 대기). 지금은 미리보기
 * 서버가 찍어 둔 실제 화면을 채우고, 없는 페이지는 카드가 회색 자리표시로 그린다.
 */
const shots = new Map<string, string>();

export function setPageShots(entries: Record<string, string>) {
  Object.entries(entries).forEach(([url, src]) => shots.set(url, src));
}

export function pageShot(url: string): string | undefined {
  return shots.get(url);
}
