export interface MergePair {
  survivorId: string;
  absorbedId: string;
}

/** 일괄병합 중 이미 성공한 병합과 세션이 겹치는 제안은 stale 충돌을 막기 위해 제외한다. */
export function isMergePairAvailable(consumedSessionIds: ReadonlySet<string>, pair: MergePair): boolean {
  return !consumedSessionIds.has(pair.survivorId) && !consumedSessionIds.has(pair.absorbedId);
}

export function markMergePairConsumed(consumedSessionIds: Set<string>, pair: MergePair): void {
  consumedSessionIds.add(pair.survivorId);
  consumedSessionIds.add(pair.absorbedId);
}

/**
 * 병합 확인 문구에 덧붙일 팀 공유 안내. 공유된 세션이 끼지 않으면 빈 문자열.
 *
 * 공유는 원본을 가리키는 라이브 참조라, 병합하면 팀에 보이는 범위가 사용자 모르게 바뀐다.
 */
export function sharedMergeNotice(pair: MergePair, sharedSessionIds: ReadonlySet<string>): string {
  const notes: string[] = [];
  if (sharedSessionIds.has(pair.survivorId)) {
    notes.push('합쳐질 세션이 팀에 공유 중이라, 흡수되는 세션의 페이지도 팀에 보이게 돼요.');
  }
  if (sharedSessionIds.has(pair.absorbedId)) {
    notes.push('흡수되는 세션이 팀에 공유 중이라, 병합하면 팀 화면에서 사라져요(되돌리면 다시 보여요).');
  }
  return notes.join('\n');
}
