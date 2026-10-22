import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchCollectStatus } from './api';
import { getDeviceId } from './device-id';
import { useAuth } from './useAuth';
import {
  EXPIRY_WARNING_MS,
  getActiveCollect,
  getCollectUi,
  remainingMs,
  TEAM_COLLECT_KEY,
  TEAM_COLLECT_UI_KEY,
  type ActiveCollect,
  type CollectUiState,
} from './team-collect';
import type { CollectStatus, Session, Workspace } from './types';

/**
 * 화면이 그릴 팀 수집 상태 하나. 띠·칩·첫 화면이 같은 규칙으로 고르도록 한 곳에 둔다.
 * - active / expiring: 이 기기에서 수집 중(만료 10분 전이면 expiring)
 * - paused: 일시 정지(남은 시간으로 다시 시작)
 * - ended: 끝난 창 돌아보기가 남아 있음
 * - idle: 아무것도 없음
 */
export type CollectPhase = 'idle' | 'active' | 'expiring' | 'paused' | 'ended';

export function collectPhase(active: ActiveCollect | null, ui: CollectUiState, nowMs = Date.now()): CollectPhase {
  if (active) {
    const left = remainingMs(active, nowMs);
    if (left > 0) return left <= EXPIRY_WARNING_MS ? 'expiring' : 'active';
  }
  if (ui.paused) return 'paused';
  if (ui.ended) return 'ended';
  return 'idle';
}

/**
 * 팀 범위 첫 화면의 주 행동(설계 §8.1-1).
 * - start: 허용된 팀이고 이 팀으로 수집 중이 아니다 → `팀 수집 시작`
 * - allow: 허용 안 된 팀의 owner → `팀 수집 허용하기`
 * - hint: 허용 안 된 팀의 멤버 → 1단계 주 행동 유지 + "owner가 허용하면 켤 수 있어요"
 * - none: 이 팀으로 이미 수집 중이거나 일시 정지·돌아보기 중(칩·카드가 행동을 맡는다)
 */
export type StartCta = 'start' | 'allow' | 'hint' | 'none';

export function startCta(team: Workspace, phase: CollectPhase, collectingTeamId: string | null): StartCta {
  if (collectingTeamId === team.id && phase !== 'idle') return 'none';
  if (team.collectAllowed) return 'start';
  return team.role === 'owner' ? 'allow' : 'hint';
}

/**
 * 돌아보기에 `팀에서 빼기`로 보일 세션 — 그 창의 세션 중 지금도 그 팀에 공유된 것만.
 * owner 가 이미 공유를 풀었거나 내가 뺀 세션에 버튼을 보이면 눌러도 404 가 난다.
 */
export function reviewableSessions(sessions: Session[], workspaceId: string): Session[] {
  return sessions.filter((s) => s.sharedWorkspaceIds?.includes(workspaceId));
}

/** 지금 계정의 팀 수집 상태. chrome.storage.session 변경을 구독하고, 남은 시간을 위해 15초마다 다시 그린다. */
export function useTeamCollect() {
  const { session } = useAuth();
  const accountId = session?.user.id ?? null;
  const [active, setActive] = useState<ActiveCollect | null>(null);
  const [ui, setUi] = useState<CollectUiState>({});
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!accountId) {
      setActive(null);
      setUi({});
      return;
    }
    let alive = true;
    const load = () => {
      void Promise.all([getActiveCollect(accountId), getCollectUi(accountId)]).then(([nextActive, nextUi]) => {
        if (!alive) return;
        setActive(nextActive);
        setUi(nextUi);
        setNow(Date.now());
      });
    };
    load();
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && (TEAM_COLLECT_KEY in changes || TEAM_COLLECT_UI_KEY in changes)) load();
    };
    chrome.storage.onChanged.addListener(listener);
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(listener);
      clearInterval(tick);
    };
  }, [accountId]);

  const phase = collectPhase(active, ui, now);
  /** 칩·띠에 보일 팀(수집 중·일시 정지·돌아보기 중 어느 쪽이든). */
  const teamId = active?.workspaceId ?? ui.paused?.workspaceId ?? ui.ended?.workspaceId ?? null;
  return {
    accountId,
    active: phase === 'active' || phase === 'expiring' ? active : null,
    ui,
    phase,
    teamId,
    remaining: active ? remainingMs(active, now) : 0,
  };
}

export function collectStatusQueryKey(workspaceId: string) {
  return ['workspaces', workspaceId, 'collect'] as const;
}

/** 이 팀으로 지금 수집 중인 멤버와 내 다른 기기의 창. 투명성 표시라 1분마다 다시 받는다. */
export function useCollectStatus(workspaceId: string | null) {
  return useQuery({
    queryKey: collectStatusQueryKey(workspaceId ?? ''),
    queryFn: async (): Promise<CollectStatus & { otherDevices: CollectStatus['myWindows'] }> => {
      const [status, deviceId] = await Promise.all([fetchCollectStatus(workspaceId!), getDeviceId()]);
      return { ...status, otherDevices: status.myWindows.filter((w) => w.deviceId !== deviceId) };
    },
    enabled: !!workspaceId,
    refetchInterval: 60_000,
  });
}

/** 연결 끊김 표시(설계 §8.1 상태). 끊긴 동안의 방문은 큐에 남았다가 서버가 늦은 도착 규칙으로 판정한다. */
export function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
