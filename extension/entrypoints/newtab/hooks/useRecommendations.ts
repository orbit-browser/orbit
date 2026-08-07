import { useQuery } from '@tanstack/react-query';
import { fetchRecommendations } from '../../../lib/api';

/**
 * 추천 세션 — 새 탭을 열 때 한 번만 조회한다.
 *
 * 서버가 캐시 + 백그라운드 재계산(stale-while-revalidate)을 담당하므로
 * 클라이언트는 폴링하지 않는다. `staleTime` 을 길게 둬서 같은 탭 안에서
 * 리렌더가 일어나도 다시 부르지 않게 한다.
 */
export function useRecommendations(context: { currentTitle?: string; currentUrl?: string } = {}) {
  return useQuery({
    queryKey: ['newtab', 'recommendations', context.currentUrl ?? ''],
    queryFn: () => fetchRecommendations(context),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}
