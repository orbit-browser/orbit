import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  fetchFolderSuggestions,
  fetchFolders,
  fetchSessionEvents,
  fetchSessions,
} from '../../../lib/api';
import type { FolderNode, SessionNode, SuggestionNode } from '../components/atlas/data';
import {
  buildAtlasSessions,
  buildFolderNodes,
  buildSuggestionNodes,
} from '../components/atlas/data';

const EVENT_REQUEST_CONCURRENCY = 6;

export interface AtlasData {
  /** 폴더 소속과 무관한 전체 세션 (최신순). */
  sessions: SessionNode[];
  folders: FolderNode[];
  /** 아직 어떤 폴더에도 넣지 않은 세션. */
  unfiled: SessionNode[];
}

async function fetchEventsInBatches(sessionIds: string[]) {
  const eventsBySession = new Map<string, Awaited<ReturnType<typeof fetchSessionEvents>>>();

  for (let index = 0; index < sessionIds.length; index += EVENT_REQUEST_CONCURRENCY) {
    const batch = sessionIds.slice(index, index + EVENT_REQUEST_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (sessionId) => [sessionId, await fetchSessionEvents(sessionId)] as const),
    );
    results.forEach(([sessionId, events]) => eventsBySession.set(sessionId, events));
  }

  return eventsBySession;
}

export async function fetchAtlasData(): Promise<AtlasData> {
  // 폴더 조회가 실패해도 세션은 보여준다 — 정리 기능이 없다고 기록 자체를 감출 이유는 없다.
  const [sessions, folders] = await Promise.all([
    fetchSessions(),
    fetchFolders().catch(() => []),
  ]);
  const eventsBySession = await fetchEventsInBatches(sessions.map((session) => session.id));
  const nodes = buildAtlasSessions(sessions, eventsBySession);
  return { sessions: nodes, ...buildFolderNodes(folders, nodes) };
}

export const ATLAS_QUERY_KEY = ['newtab', 'atlas-data'] as const;

export function useAtlasData() {
  return useQuery({
    queryKey: ATLAS_QUERY_KEY,
    queryFn: fetchAtlasData,
  });
}

/**
 * 미정리 세션별 폴더 제안. Atlas 데이터와 따로 불러와 벡터 검색이 느려도 세션 목록이 먼저 그려진다.
 * Atlas 데이터가 새로 오면(배정·동기화 뒤) 제안도 다시 받는다. 실패(벡터 DB 장애 503 등)는 제안 없음과 같다.
 */
export function useFolderSuggestions(atlas: AtlasData | undefined, atlasUpdatedAt: number): SuggestionNode[] {
  const { data } = useQuery({
    queryKey: ['newtab', 'folder-suggestions', atlasUpdatedAt],
    queryFn: () => fetchFolderSuggestions().catch(() => []),
    enabled: atlas !== undefined,
    placeholderData: keepPreviousData,
  });
  return useMemo(
    () => (atlas && data ? buildSuggestionNodes(data, atlas.folders, atlas.unfiled, atlas.sessions) : []),
    [atlas, data],
  );
}
