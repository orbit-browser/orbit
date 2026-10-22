/**
 * 부스 배치 — 족자 현수막 7장(950 × 2380mm 5장 + 455 × 2380mm 2장, 대표 2026-10-20).
 * 정면에서 본 순서: 왼쪽 벽 [455][950] · 가운데 벽 [950][950][950] · 오른쪽 벽 [950][455].
 * 455 두 장은 부스 앞쪽 가장자리다. 주최 측 배치도의 벽 기둥은 40mm.
 */
export type Wall = 'left' | 'center' | 'right';

export interface PanelDef {
  id: 'edge-left' | 'use' | 'chaos' | 'orbit' | 'tech' | 'team' | 'edge-right';
  width: 950 | 455;
  wall: Wall;
  /** 보기 화면의 이름 */
  label: string;
}

export const PANELS: PanelDef[] = [
  { id: 'edge-left', width: 455, wall: 'left', label: '왼쪽 앞 띠' },
  { id: 'use', width: 950, wall: 'left', label: 'USE' },
  { id: 'chaos', width: 950, wall: 'center', label: '01 CHAOS' },
  { id: 'orbit', width: 950, wall: 'center', label: '02 ORBIT' },
  { id: 'tech', width: 950, wall: 'center', label: '03 TECHNOLOGY' },
  { id: 'team', width: 950, wall: 'right', label: 'TEAM' },
  { id: 'edge-right', width: 455, wall: 'right', label: '오른쪽 앞 띠' },
];

export const WALLS: { wall: Wall; label: string }[] = [
  { wall: 'left', label: '왼쪽 벽' },
  { wall: 'center', label: '가운데 벽' },
  { wall: 'right', label: '오른쪽 벽' },
];

export const BOOTH = {
  height: 2380,
  /** 같은 벽 안 현수막 사이(벽 기둥) */
  post: 40,
  /** 미리보기에서 벽과 벽 사이(모서리) */
  corner: 160,
  /** 팀 이름(대표 2026-10-20). 팀원 이름은 넣지 않는다 */
  team: 'Orbit',
  /** QR 빈 칸 한 변(mm) — 출력 뒤 스티커로 붙인다. 오른쪽 앞 띠의 눈높이에 있다 */
  qr: 100,
};
