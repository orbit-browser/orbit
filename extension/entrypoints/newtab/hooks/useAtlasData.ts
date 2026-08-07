import { useQuery } from '@tanstack/react-query';
import { fetchFolders, fetchSessionEvents, fetchSessions } from '../../../lib/api';
import type { FolderNode, SessionNode } from '../components/atlas/data';
import { buildAtlasSessions, buildFolderNodes } from '../components/atlas/data';

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
