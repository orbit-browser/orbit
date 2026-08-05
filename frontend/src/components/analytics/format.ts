// "탐색 분석" 카드들이 공유하는 포맷 유틸.

/** 예: 28800000 -> "8시간", 45 * 60_000 -> "45분", 8시간 12분 -> "8시간 12분" */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(Math.round(ms / 60_000), 0);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}분`;
  if (minutes === 0) return `${hours}시간`;
  return `${hours}시간 ${minutes}분`;
}

/** "2026-07-28" -> "7/28" */
export function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
