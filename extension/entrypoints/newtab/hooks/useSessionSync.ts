import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { onSessionChange, type SessionChange } from '../../../lib/session-events';

/** 흡수되는 세션이 사라지는 애니메이션 길이. CSS의 `atlas-merge-absorb` 와 맞춘다. */
const ABSORB_MS = 420;

export interface SessionSync {
  /** 지금 병합되어 사라지는 중인 세션 id — 행을 접는 애니메이션에 쓴다. */
  absorbingId: string | null;
  /** 방금 다른 세션을 흡수한 세션 id — 잠깐 강조한다. */
  survivingId: string | null;
}

/**
 * 사이드패널에서 일어난 세션 변경을 새 탭에 반영한다.
 *
 * 새로고침 없이 목록이 갱신되고, 병합은 흡수되는 행이 접히는 애니메이션을 거친 뒤
 * 데이터를 다시 불러온다 — 목록이 즉시 튀면 무슨 일이 일어났는지 알 수 없다.
 */
export function useSessionSync(): SessionSync {
  const queryClient = useQueryClient();
  const [absorbingId, setAbsorbingId] = useState<string | null>(null);
  const [survivingId, setSurvivingId] = useState<string | null>(null);

  const refetch = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['newtab', 'atlas-data'] });
    void queryClient.invalidateQueries({ queryKey: ['newtab', 'recommendations'] });
  }, [queryClient]);

  useEffect(() => {
    let absorbTimer: ReturnType<typeof setTimeout> | undefined;
    let highlightTimer: ReturnType<typeof setTimeout> | undefined;

    const handle = (change: SessionChange) => {
      if (change.type === 'sessions:merged') {
        // 먼저 접는 애니메이션을 보여주고, 끝난 뒤에 목록을 새로 받는다.
        setAbsorbingId(change.absorbedId);
        setSurvivingId(change.survivorId);

        absorbTimer = setTimeout(() => {
          setAbsorbingId(null);
          refetch();
          highlightTimer = setTimeout(() => setSurvivingId(null), 900);
        }, ABSORB_MS);
        return;
      }

      // 병합 해제·기타 변경은 곧바로 반영한다(사라지는 것이 없어 애니메이션이 필요 없다).
      refetch();
    };

    const unsubscribe = onSessionChange(handle);
    return () => {
      unsubscribe();
      clearTimeout(absorbTimer);
      clearTimeout(highlightTimer);
    };
  }, [refetch]);

  return { absorbingId, survivingId };
}
