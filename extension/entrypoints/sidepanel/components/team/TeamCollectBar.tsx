import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { updateSettings } from '../../../../lib/settings';
import {
  clearPaused,
  DEFAULT_COLLECT_DURATION,
  endTeamCollect,
  formatRemaining,
  resumeDuration,
  startTeamCollect,
} from '../../../../lib/team-collect';
import { useOnline, useTeamCollect } from '../../../../lib/useTeamCollect';
import { teamLabel, WORKSPACES_QUERY_KEY } from '../../../../lib/useWorkspaces';

const BUTTON =
  'shrink-0 cursor-pointer rounded-md px-2 py-1 text-[11px] font-bold transition hover:bg-orbit-bg focus-visible:outline-2 focus-visible:outline-orbit-primary disabled:cursor-default disabled:opacity-50';
const PRIMARY =
  'shrink-0 cursor-pointer rounded-md bg-orbit-primary px-2 py-1 text-[11px] font-bold text-white transition hover:brightness-95 disabled:opacity-50';

/**
 * 사이드패널 상단 띠(설계 §8.1-3·4). 켜진 동안 팀 색 점·남은 시간·일시 정지·끄기를 늘 보인다.
 * 사이드패널 개인 화면 개편이 아니라 상태 표시다(대표 범위 지시: 필수 표시만).
 * 끝난 창 돌아보기는 새 탭 팀 화면의 카드가 맡고, 띠는 그 자리로 데려간다.
 */
export function TeamCollectBar() {
  const { accountId, active, ui, phase, remaining } = useTeamCollect();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const online = useOnline();
  const client = useQueryClient();

  if (!accountId || phase === 'idle') return null;

  const run = async (label: string, task: () => Promise<unknown>) => {
    setBusy(label);
    setError(false);
    try {
      await task();
      void client.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY });
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  };

  const hue = active?.hue ?? ui.paused?.hue;
  const name = active?.workspaceName ?? ui.paused?.workspaceName ?? ui.ended?.workspaceName ?? '';
  const team = active
    ? { id: active.workspaceId, name: active.workspaceName, hue: active.hue }
    : ui.paused
      ? { id: ui.paused.workspaceId, name: ui.paused.workspaceName, hue: ui.paused.hue }
      : null;
  const spinner = (label: string) =>
    busy === label ? <Loader2 size={11} className="mr-0.5 inline animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null;

  return (
    <div
      role="status"
      className={
        'flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-[11px] transition-colors duration-200 motion-safe:animate-[orbit-fade-in_0.2s_ease] ' +
        (phase === 'expiring' ? 'border-orbit-danger/40 bg-orbit-danger-soft' : 'border-orbit-border bg-orbit-surface')
      }
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: phase === 'active' || phase === 'expiring' ? hue : 'var(--color-orbit-muted)' }}
        aria-hidden="true"
      />
      <p className="min-w-0 flex-1 truncate font-semibold text-orbit-text">
        {phase === 'active' && `${name}으로 수집 중 · ${formatRemaining(remaining)} 남음`}
        {phase === 'expiring' && `곧 꺼져요 · ${formatRemaining(remaining)} 남음`}
        {phase === 'paused' && `${teamLabel(name)} 수집 일시 정지됨`}
        {phase === 'ended' && `${teamLabel(name)} 수집이 끝났어요`}
        {!online && phase !== 'ended' && <span className="ml-1 font-normal text-orbit-muted">· 연결 안 됨 · 다시 연결되면 보내요</span>}
        {error && <span className="ml-1 font-normal text-orbit-danger">· 서버에 알리지 못해 다시 보낼게요</span>}
      </p>

      {(phase === 'active' || phase === 'expiring') && team && (
        <>
          {phase === 'expiring' && (
            <button type="button" className={PRIMARY} disabled={busy !== null} onClick={() => void run('extend', () => startTeamCollect(team, DEFAULT_COLLECT_DURATION))}>
              {spinner('extend')}연장
            </button>
          )}
          <button type="button" className={BUTTON + ' text-orbit-muted'} disabled={busy !== null} onClick={() => void run('pause', () => endTeamCollect(accountId, 'pause'))}>
            {spinner('pause')}일시 정지
          </button>
          <button type="button" className={BUTTON + ' text-orbit-danger'} disabled={busy !== null} onClick={() => void run('stop', () => endTeamCollect(accountId, 'stop'))}>
            {spinner('stop')}끄기
          </button>
        </>
      )}
      {phase === 'paused' && team && ui.paused && (
        <>
          <button type="button" className={PRIMARY} disabled={busy !== null} onClick={() => void run('resume', () => startTeamCollect(team, resumeDuration(ui.paused!.remainingMs)))}>
            {spinner('resume')}다시 시작
          </button>
          <button type="button" className={BUTTON + ' text-orbit-muted'} disabled={busy !== null} onClick={() => void run('clear', () => clearPaused(accountId))}>
            끄기
          </button>
        </>
      )}
      {phase === 'ended' && ui.ended && (
        <button
          type="button"
          className={PRIMARY}
          onClick={() => {
            void updateSettings({ activeWorkspaceId: ui.ended!.workspaceId });
            void chrome.tabs.create({ url: chrome.runtime.getURL('/newtab.html') });
          }}
        >
          돌아보기
        </button>
      )}
    </div>
  );
}
