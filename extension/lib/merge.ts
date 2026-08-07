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
