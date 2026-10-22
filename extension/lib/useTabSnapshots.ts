import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getSession } from './auth';
import { getSettings, subscribeSettings } from './settings';
import { loadSnapshots } from './tab-snapshots';

export const TAB_SNAPSHOTS_QUERY_KEY = ['tab-snapshots'] as const;

/** 미리보기를 끈 동안은 이미 찍은 사진도 보이지 않는다(지울지는 설정 화면이 묻는다). */
export async function fetchTabSnapshots(urls: readonly string[]): Promise<Record<string, string>> {
  if (!(await getSettings()).tabSnapshotsEnabled) return {};
  const session = await getSession();
  return session ? loadSnapshots(session.user.id, urls) : {};
}

/**
 * 지금 계정이 이 기기에서 찍은 페이지 사진(정규화 URL → data URL). 사진이 없으면 빈 객체라 화면은
 * 파비콘·회색 칸을 그대로 그린다. 계정을 바꾸면 쿼리 캐시가 통째로 비워지고(`query-client`) 새 계정
 * 것만 읽는다. `enabled` 가 false 면(남의 팀 세션) 읽지 않는다.
 */
export function useTabSnapshots(urls: readonly string[], enabled = true): Record<string, string> {
  const client = useQueryClient();
  useEffect(
    () =>
      subscribeSettings((next, previous) => {
        if (next.tabSnapshotsEnabled !== previous.tabSnapshotsEnabled) {
          void client.resetQueries({ queryKey: TAB_SNAPSHOTS_QUERY_KEY });
        }
      }),
    [client],
  );
  const { data } = useQuery({
    queryKey: [...TAB_SNAPSHOTS_QUERY_KEY, [...urls].sort()],
    queryFn: () => fetchTabSnapshots(urls),
    enabled: enabled && urls.length > 0,
  });
  return enabled && data ? data : {};
}
