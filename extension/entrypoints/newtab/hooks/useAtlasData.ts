import { useQuery } from '@tanstack/react-query';
import { fetchSessionEvents, fetchSessions } from '../../../lib/api';
import { buildAtlasSessions } from '../components/atlas/data';

const EVENT_REQUEST_CONCURRENCY = 6;

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

export async function fetchAtlasData() {
  const sessions = await fetchSessions();
  const eventsBySession = await fetchEventsInBatches(sessions.map((session) => session.id));
  return buildAtlasSessions(sessions, eventsBySession);
}

export function useAtlasData() {
  return useQuery({
    queryKey: ['newtab', 'atlas-data'],
    queryFn: fetchAtlasData,
  });
}
