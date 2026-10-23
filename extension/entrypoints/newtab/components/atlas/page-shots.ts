/**
 * 미리보기 서버가 찍어 둔 페이지 화면(카드 썸네일), 키는 페이지 URL.
 *
 * 확장에서는 비어 있다 — 실제 확장의 화면은 기기 안에서 찍은 사진(`lib/tab-snapshots.ts`)을 쓴다.
 * 미리보기에는 서비스 워커가 없어 찍을 수 없으므로 이것으로 채운다.
 */
const shots = new Map<string, string>();

export function setPageShots(entries: Record<string, string>) {
  Object.entries(entries).forEach(([url, src]) => shots.set(url, src));
}

export function pageShot(url: string): string | undefined {
  return shots.get(url);
}
