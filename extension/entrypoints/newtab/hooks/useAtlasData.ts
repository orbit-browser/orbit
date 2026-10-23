import { useEffect, useMemo } from 'react';
import { keepPreviousData, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  fetchFolderSuggestions,
  fetchFolders,
  fetchSessionEvents,
  fetchSessions,
  fetchWorkspaceSessionIds,
  fetchWorkspaceSessions,
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

/** workspaceId 가 있으면 그 팀에 공유된 세션을 그린다. 폴더는 개인 정리 수단이라 팀에는 없다. */
export async function fetchAtlasData(workspaceId: string | null = null): Promise<AtlasData> {
  // 폴더 조회가 실패해도 세션은 보여준다 — 정리 기능이 없다고 기록 자체를 감출 이유는 없다.
  const [sessions, folders] = await Promise.all([
    workspaceId ? fetchWorkspaceSessions(workspaceId) : fetchSessions(),
    workspaceId ? [] : fetchFolders().catch(() => []),
  ]);
  const eventsBySession = await fetchEventsInBatches(sessions.map((session) => session.id));
  const nodes = buildAtlasSessions(sessions, eventsBySession);
  return { sessions: nodes, ...buildFolderNodes(folders, nodes) };
}

export const ATLAS_QUERY_KEY = ['newtab', 'atlas-data'] as const;

export function useAtlasData(workspaceId: string | null = null) {
  const client = useQueryClient();
  const atlas = useQuery({
    // 범위마다 따로 캐시한다. ATLAS_QUERY_KEY 로 무효화하면 모든 범위가 함께 갱신된다.
    queryKey: [...ATLAS_QUERY_KEY, workspaceId],
    queryFn: () => fetchAtlasData(workspaceId),
    // 돌아왔을 때 팀 범위는 신선해도 다시 받는다 — 공유가 풀린 세션이 남아 있으면 안 된다.
    refetchOnWindowFocus: workspaceId ? 'always' : true,
  });
  const shared = useQuery({ ...teamShareQueryOptions(workspaceId ?? ''), enabled: !!workspaceId });
  useEffect(() => {
    if (workspaceId && shared.data) reconcileTeamShares(client, workspaceId, shared.data);
    // 아틀라스가 공유 해제 전에 출발한 요청으로 늦게 덮여도 다시 맞추도록 그 갱신 시각도 본다.
  }, [client, workspaceId, shared.data, atlas.dataUpdatedAt]);
  return atlas;
}

/** 사이드패널 팀 화면과 같은 기준(10초 안)으로 공유 해제를 비춘다. */
export const TEAM_SHARE_POLL_MS = 8_000;

/**
 * 팀 범위에서 공유된 세션 id 만 짧게 확인한다(아틀라스 전체는 세션마다 이벤트를 받아 무겁다).
 * react-query 는 창이 포커스를 잃으면 주기 갱신을 멈추는데, 다른 창 옆에 띄워 둔 새 탭도 비춰야 하므로
 * 포커스가 아니라 화면에 보이는지로 정한다. 숨었다 다시 보이면 포커스 갱신이 주기를 되살린다.
 */
export function teamShareQueryOptions(workspaceId: string) {
  return {
    queryKey: ['newtab', 'team-share-ids', workspaceId],
    queryFn: () => fetchWorkspaceSessionIds(workspaceId),
    refetchInterval: () => (globalThis.document?.visibilityState === 'visible' ? TEAM_SHARE_POLL_MS : false),
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: 'always' as const,
  };
}

const unshareListeners = new Set<(count: number) => void>();

/** 보고 있던 팀 화면에서 공유가 풀린 세션이 빠졌을 때 안내를 띄우도록 알린다. */
export function onTeamSessionsUnshared(listener: (count: number) => void) {
  unshareListeners.add(listener);
  return () => {
    unshareListeners.delete(listener);
  };
}

/**
 * 서버의 공유 목록과 캐시된 팀 아틀라스를 맞춘다. 풀린 세션은 다음 아틀라스 요청을 기다리지 않고 바로
 * 빼고 알린다. 새로 공유된 세션은 페이지 정보가 필요해 아틀라스를 다시 받는다.
 */
export function reconcileTeamShares(client: QueryClient, workspaceId: string, liveIds: string[]) {
  const key = [...ATLAS_QUERY_KEY, workspaceId];
  const data = client.getQueryData<AtlasData>(key);
  if (!data) return;
  const live = new Set(liveIds);
  const kept = data.sessions.filter((session) => live.has(session.id));
  const removed = data.sessions.length - kept.length;
  if (removed > 0) {
    client.setQueryData<AtlasData>(key, {
      ...data,
      sessions: kept,
      unfiled: data.unfiled.filter((session) => live.has(session.id)),
    });
    unshareListeners.forEach((listener) => listener(removed));
  }
  if (liveIds.some((id) => !data.sessions.some((session) => session.id === id))) {
    void client.invalidateQueries({ queryKey: key });
  }
}

/**
 * 미정리 세션별 폴더 제안. Atlas 데이터와 따로 불러와 벡터 검색이 느려도 세션 목록이 먼저 그려진다.
 * Atlas 데이터가 새로 오면(배정·동기화 뒤) 제안도 다시 받는다. 실패(벡터 DB 장애 503 등)는 제안 없음과 같다.
 */
export function useFolderSuggestions(
  atlas: AtlasData | undefined,
  atlasUpdatedAt: number,
  enabled = true,
): SuggestionNode[] {
  const { data } = useQuery({
    queryKey: ['newtab', 'folder-suggestions', atlasUpdatedAt],
    queryFn: () => fetchFolderSuggestions().catch(() => []),
    enabled: enabled && atlas !== undefined,
    placeholderData: keepPreviousData,
  });
  return useMemo(
    () => (enabled && atlas && data ? buildSuggestionNodes(data, atlas.folders, atlas.unfiled, atlas.sessions) : []),
    [atlas, data, enabled],
  );
}
