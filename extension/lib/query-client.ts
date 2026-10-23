import { focusManager, MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';
import { onSessionChange } from './auth';
import { confirmTeamAccess } from './useWorkspaces';

/**
 * 팀 범위 요청이 403/404 면 팀에서 내보내졌거나 팀이 지워졌을 수 있다. 서버는 철회 직후부터
 * 막으므로, 화면이 다음 주기를 기다리지 않고 바로 팀 목록을 확인해 범위를 정리하게 한다.
 */
function watchTeamAccess(error: Error) {
  if (!(error instanceof ApiError) || (error.status !== 403 && error.status !== 404)) return;
  const teamId = /^\/workspaces\/([^/?]+)/.exec(error.path)?.[1];
  if (teamId && teamId !== 'join') void confirmTeamAccess(queryClient, teamId);
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: watchTeamAccess }),
  mutationCache: new MutationCache({ onError: watchTeamAccess }),
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

/**
 * react-query 는 탭이 다시 보일 때(visibilitychange)만 포커스로 친다. 새 탭은 다른 창이나 앱에서
 * 돌아올 때도 다시 받아야 해서 창 focus·blur 도 듣는다. 값이 바뀔 때만 다시 받으므로 blur 로 내려 둔다.
 */
export function trackWindowFocus() {
  focusManager.setEventListener((setFocused) => {
    const onVisibility = () => setFocused(document.visibilityState === 'visible');
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    window.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  });
}
