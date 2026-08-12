import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  assignSessionsToFolder,
  createFolder,
  deleteFolder,
  removeSessionFromFolder,
  renameFolder,
  setSessionAlias,
} from '../../../lib/api';
import { ATLAS_QUERY_KEY } from './useAtlasData';

/**
 * 폴더 변경 뮤테이션 묶음.
 *
 * 폴더 목록과 세션 소속은 한 쿼리(atlas-data)에 함께 담겨 있으므로 성공 시 그 쿼리
 * 하나만 무효화한다. 낙관적 갱신은 하지 않는다 — 배정은 서버가 소유권을 확인한 뒤
 * 일부만 반영될 수 있어(skipped) 화면이 먼저 앞서가면 실제 결과와 어긋난다.
 */
export function useFolderMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ATLAS_QUERY_KEY });

  const create = useMutation({
    mutationFn: (name: string) => createFolder(name),
    onSuccess: invalidate,
  });

  const rename = useMutation({
    mutationFn: ({ folderId, name }: { folderId: string; name: string }) =>
      renameFolder(folderId, name),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (folderId: string) => deleteFolder(folderId),
    onSuccess: invalidate,
  });

  const assign = useMutation({
    mutationFn: ({ folderId, sessionIds }: { folderId: string; sessionIds: string[] }) =>
      assignSessionsToFolder(folderId, sessionIds),
    onSuccess: invalidate,
  });

  const unassign = useMutation({
    mutationFn: ({ folderId, sessionId }: { folderId: string; sessionId: string }) =>
      removeSessionFromFolder(folderId, sessionId),
    onSuccess: invalidate,
  });

  /**
   * 세션 이름 변경 — 사용자에게는 이름 수정이지만 서버에는 별칭으로 저장된다.
   * 빈 문자열이면 별칭을 지우고 AI 가 만든 원래 이름으로 돌아간다.
   */
  const renameSessionAlias = useMutation({
    mutationFn: ({ sessionId, alias }: { sessionId: string; alias: string }) =>
      setSessionAlias(sessionId, alias.trim() || null),
    onSuccess: invalidate,
  });

  return { create, rename, remove, assign, unassign, renameSessionAlias };
}
