import { useQuery } from '@tanstack/react-query';
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
  /** 미정리 세션별 폴더 제안. */
  suggestions: SuggestionNode[];
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
  // 폴더·제안 조회가 실패해도 세션은 보여준다 — 정리 기능이 없다고 기록 자체를 감출 이유는 없다.
  // 제안은 벡터 DB 가 내려가면 503 이 오는데, 그때는 제안이 없는 것과 같다.
  const [sessions, folders, suggestions] = await Promise.all([
    fetchSessions(),
    fetchFolders().catch(() => []),
    fetchFolderSuggestions().catch(() => []),
  ]);
  const eventsBySession = await fetchEventsInBatches(sessions.map((session) => session.id));
  const nodes = buildAtlasSessions(sessions, eventsBySession);
  const grouped = buildFolderNodes(folders, nodes);
  return {
    sessions: nodes,
    ...grouped,
    suggestions: buildSuggestionNodes(suggestions, grouped.folders, grouped.unfiled, nodes),
  };
}

export const ATLAS_QUERY_KEY = ['newtab', 'atlas-data'] as const;

export function useAtlasData() {
  return useQuery({
    queryKey: ATLAS_QUERY_KEY,
    queryFn: fetchAtlasData,
  });
}
