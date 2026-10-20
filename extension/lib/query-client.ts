import { QueryClient } from '@tanstack/react-query';
import { onSessionChange } from './auth';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// 계정이 바뀌거나 로그아웃하면 이전 계정의 캐시를 버린다. 같은 브라우저에서 다음 계정이
// 로그인했을 때 남의 세션·팀 목록이 캐시에서 잠깐이라도 보이면 안 된다. 저장소 변경을 구독하므로
// 어느 화면에서 로그아웃해도 사이드패널·새 탭 모두 비워진다.
onSessionChange((session, previous) => {
  if (session?.user.id !== previous?.user.id) queryClient.clear();
});
