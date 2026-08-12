/**
 * 세션 색 — 새 탭 궤도 캔버스와 사이드패널이 함께 쓴다.
 *
 * 같은 세션은 두 화면에서 같은 색을 갖는다. 색이 장식이 아니라 "이 세션과 저 세션이
 * 같다"는 정보를 나르기 때문에, 팔레트와 배정 규칙이 한 곳에 있어야 어긋나지 않는다.
 */
export const SESSION_HUES = [
  '#ef6f47',
  '#e09528',
  '#7fa452',
  '#3aa09a',
  '#727bcb',
  '#c06aa2',
] as const;

/** 세션 id 로 색을 정한다 — 서버가 색을 주지 않으므로 id 에서 결정론적으로 뽑는다. */
export function hueForSession(id: string): string {
  const hash = [...id].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0);
  return SESSION_HUES[hash % SESSION_HUES.length];
}
