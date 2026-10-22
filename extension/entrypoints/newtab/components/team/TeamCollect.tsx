import { useEffect, useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Radio, Undo2, X } from 'lucide-react';
import {
  ApiError,
  fetchWindowSessions,
  restoreCollectSession,
  setCollectAllowed,
  unshareSession,
} from '../../../../lib/api';
import {
  clearPaused,
  COLLECT_DURATIONS,
  DEFAULT_COLLECT_DURATION,
  dismissReview,
  endTeamCollect,
  formatRemaining,
  hasTeamConsent,
  resumeDuration,
  startTeamCollect,
  stopAllDevices,
  TEAM_COLLECT_DISCLOSURE,
  TEAM_COLLECT_STOP_CONDITIONS,
  withdrawTeamWindow,
  type CollectDuration,
  type EndedCollect,
} from '../../../../lib/team-collect';
import type { Session, Workspace } from '../../../../lib/types';
import { reviewableSessions, startCta, useCollectStatus, useOnline, useTeamCollect } from '../../../../lib/useTeamCollect';
import { useActiveWorkspace, WORKSPACES_QUERY_KEY } from '../../../../lib/useWorkspaces';
import { updateSettings } from '../../../../lib/settings';
import { openSettings } from '../../lib/navigation';

const DURATION_LABEL: Record<CollectDuration, string> = {
  30: '30분',
  60: '1시간',
  120: '2시간',
  240: '4시간',
  480: '8시간',
};

function useRefreshCollect() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY });
  };
}

// ── 첫 화면 주 행동 ───────────────────────────────────────────────

/**
 * 팀 범위 첫 화면의 팀 수집 자리(설계 §8.1-1·5). 끝난 창이 있으면 돌아보기 카드가, 아니면 주 버튼 하나가 선다.
 */
export function TeamCollectPanel({ team }: { team: Workspace }) {
  const { accountId, active, ui, phase, teamId } = useTeamCollect();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [allowing, setAllowing] = useState(false);
  const [allowError, setAllowError] = useState<string | null>(null);
  const refresh = useRefreshCollect();

  if (!accountId) return null;
  if (ui.ended && ui.ended.workspaceId === team.id) {
    return <TeamCollectReview accountId={accountId} ended={ui.ended} pending={ui.withdrawPending ?? []} />;
  }

  const cta = startCta(team, phase, teamId);
  if (cta === 'none') return null;

  const allow = async () => {
    setAllowing(true);
    setAllowError(null);
    try {
      await setCollectAllowed(team.id, true);
      refresh();
    } catch {
      setAllowError('허용하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    } finally {
      setAllowing(false);
    }
  };

  return (
    <section className="team-collect-cta" aria-label="팀 수집">
      <span className="team-collect-cta__dot" style={{ '--team-hue': team.hue } as React.CSSProperties} aria-hidden="true" />
      <div className="team-collect-cta__text">
        {cta === 'start' && (
          <>
            <strong>이 기기에서 여는 페이지를 팀 기록으로 모아요</strong>
            <span>정한 시간 동안만 켜지고, 은행·로그인·메일·메신저·검색 결과는 팀으로 가지 않아요.</span>
          </>
        )}
        {cta === 'allow' && (
          <>
            <strong>팀 수집이 꺼져 있어요</strong>
            <span>허용하면 팀원이 각자 시간을 정해 팀 기록을 모을 수 있어요.</span>
          </>
        )}
        {cta === 'hint' && (
          <>
            <strong>팀 수집은 owner가 허용하면 켤 수 있어요</strong>
            <span>그 전까지는 내 세션을 팀에 공유해 함께 볼 수 있어요.</span>
          </>
        )}
        {allowError && (
          <span className="team-collect-cta__error" role="alert">
            {allowError}
          </span>
        )}
      </div>
      {cta === 'start' && (
        <button type="button" className="team-collect-button team-collect-button--primary" onClick={() => setSheetOpen(true)}>
          <Radio size={14} aria-hidden="true" /> 팀 수집 시작
        </button>
      )}
      {cta === 'allow' && (
        <button
          type="button"
          className="team-collect-button team-collect-button--primary"
          disabled={allowing}
          aria-busy={allowing}
          onClick={() => void allow()}
        >
          {allowing && <Loader2 size={14} className="team-collect-spin" aria-hidden="true" />}
          {allowing ? '허용하는 중…' : '팀 수집 허용하기'}
        </button>
      )}
      {sheetOpen && (
        <TeamCollectConsentSheet
          accountId={accountId}
          team={team}
          switchingFrom={active && active.workspaceId !== team.id ? active.workspaceName : null}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </section>
  );
}

// ── 동의 시트 (설계 §7.2) ─────────────────────────────────────────

export function TeamCollectConsentSheet({
  accountId,
  team,
  switchingFrom,
  onClose,
}: {
  accountId: string;
  team: Pick<Workspace, 'id' | 'name' | 'hue'>;
  /** 이 기기에서 다른 팀으로 수집 중이면 그 팀 이름. 시작하면 서버가 그 창을 끝낸다. */
  switchingFrom: string | null;
  onClose: () => void;
}) {
  const titleId = useId();
  const [duration, setDuration] = useState<CollectDuration>(DEFAULT_COLLECT_DURATION);
  const [consented, setConsented] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const refresh = useRefreshCollect();

  useEffect(() => {
    void hasTeamConsent(accountId, team.id).then(setConsented);
  }, [accountId, team.id]);

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, pending]);

  const start = async () => {
    setPending(true);
    setError(null);
    try {
      await startTeamCollect(team, duration);
      refresh();
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? '시작하지 못했어요. owner가 허용을 껐거나 다른 시작 요청이 겹쳤어요. 다시 시도해 주세요.'
          : '시작하지 못했어요. 연결을 확인하고 다시 시도해 주세요.',
      );
      setPending(false);
    }
  };

  return (
    <div className="team-collect-sheet__backdrop" onClick={() => !pending && onClose()}>
      <div
        ref={dialogRef}
        className="team-collect-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="team-collect-sheet__head">
          <h2 id={titleId}>{team.name}으로 팀 수집을 시작할까요?</h2>
          <button type="button" className="team-collect-icon-button" aria-label="닫기" disabled={pending} onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        {switchingFrom && (
          <p className="team-collect-sheet__switch" role="note">
            지금 {switchingFrom}으로 수집 중이에요. 시작하면 그 수집을 끝내고 {team.name}으로 바꿔요.
          </p>
        )}

        {consented === false ? (
          <div className="team-collect-sheet__body">
            <p>{TEAM_COLLECT_DISCLOSURE}</p>
            <p>
              <strong>언제 꺼지나요?</strong> {TEAM_COLLECT_STOP_CONDITIONS}
            </p>
            <button type="button" className="team-collect-link" onClick={() => openSettings({ page: 'workspace', workspaceId: team.id })}>
              제외 목록 편집하기
            </button>
          </div>
        ) : (
          <details className="team-collect-sheet__body">
            <summary>팀원이 보는 것과 꺼지는 조건 다시 보기</summary>
            <p>{TEAM_COLLECT_DISCLOSURE}</p>
            <p>{TEAM_COLLECT_STOP_CONDITIONS}</p>
          </details>
        )}

        <fieldset className="team-collect-durations">
          <legend>얼마 동안 켤까요?</legend>
          {COLLECT_DURATIONS.map((value) => (
            <label key={value} className={`team-collect-duration${duration === value ? ' is-selected' : ''}`}>
              <input
                type="radio"
                name="team-collect-duration"
                value={value}
                checked={duration === value}
                data-autofocus={duration === value ? '' : undefined}
                onChange={() => setDuration(value)}
              />
              {DURATION_LABEL[value]}
            </label>
          ))}
        </fieldset>

        {error && (
          <p className="team-collect-sheet__error" role="alert">
            {error}
          </p>
        )}

        <footer className="team-collect-sheet__actions">
          <button type="button" className="team-collect-button" disabled={pending} onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className="team-collect-button team-collect-button--primary"
            disabled={pending || consented === null}
            aria-busy={pending}
            onClick={() => void start()}
          >
            {pending && <Loader2 size={14} className="team-collect-spin" aria-hidden="true" />}
            {pending ? '시작하는 중…' : '팀 수집 시작'}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ── 머리 칩 (설계 §8.1-3·4) ───────────────────────────────────────

export function TeamCollectChip() {
  const { accountId, active, ui, phase, teamId, remaining } = useTeamCollect();
  const { scopeId } = useActiveWorkspace();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [extendOpen, setExtendOpen] = useState(false);
  const online = useOnline();
  const status = useCollectStatus(phase === 'idle' ? null : teamId);
  const refresh = useRefreshCollect();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!accountId || phase === 'idle') return null;
  if (phase === 'ended') {
    // 돌아보기 카드는 그 팀 화면에 선다. 다른 범위를 보고 있으면 칩이 그 자리로 데려간다.
    if (scopeId === ui.ended!.workspaceId) return null;
    return (
      <div className="team-collect-chip" data-phase="ended">
        <button
          type="button"
          className="team-collect-chip__button"
          onClick={() => void updateSettings({ activeWorkspaceId: ui.ended!.workspaceId })}
        >
          <span className="team-collect-chip__dot" aria-hidden="true" />
          팀 수집이 끝났어요 · 돌아보기
        </button>
      </div>
    );
  }
  const team = active
    ? { id: active.workspaceId, name: active.workspaceName, hue: active.hue }
    : { id: ui.paused!.workspaceId, name: ui.paused!.workspaceName, hue: ui.paused!.hue };
  const otherDevices = status.data?.otherDevices ?? [];

  const run = async (label: string, task: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await task();
      refresh();
      void status.refetch();
    } catch {
      setError('요청을 처리하지 못했어요. 이 기기의 수집은 이미 멈췄고, 서버에는 다시 보낼게요.');
    } finally {
      setBusy(null);
    }
  };

  const label =
    phase === 'paused'
      ? `${team.name} 수집 일시 정지됨`
      : phase === 'expiring'
        ? `곧 꺼져요 · ${formatRemaining(remaining)}`
        : `팀 수집 중 · ${formatRemaining(remaining)}`;

  return (
    <div className="team-collect-chip" ref={rootRef} data-phase={phase}>
      <button
        type="button"
        className="team-collect-chip__button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="team-collect-chip__dot" style={{ '--team-hue': team.hue } as React.CSSProperties} aria-hidden="true" />
        <span aria-live="polite">{label}</span>
        {!online && <span className="team-collect-chip__offline">연결 안 됨 · 다시 연결되면 보내요</span>}
        {otherDevices.length > 0 && <span className="team-collect-chip__other">다른 기기에서 수집 중</span>}
      </button>
      {open && (
        <div className="team-collect-popover" role="dialog" aria-label="팀 수집">
          <p className="team-collect-popover__title">
            {phase === 'paused' ? `${team.name} 수집을 잠시 멈췄어요` : `${team.name}으로 수집 중 · ${formatRemaining(remaining)} 남음`}
          </p>
          {phase === 'expiring' && <p className="team-collect-popover__warn">10분 안에 꺼져요. 계속 모으려면 연장하세요.</p>}

          <div className="team-collect-popover__actions">
            {phase === 'paused' ? (
              <>
                <button
                  type="button"
                  className="team-collect-button team-collect-button--primary"
                  disabled={busy !== null}
                  onClick={() => void run('resume', () => startTeamCollect(team, resumeDuration(ui.paused!.remainingMs)))}
                >
                  {busy === 'resume' ? '다시 시작하는 중…' : '다시 시작'}
                </button>
                <button type="button" className="team-collect-button" disabled={busy !== null} onClick={() => void run('clear', () => clearPaused(accountId))}>
                  끄기
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={`team-collect-button${phase === 'expiring' ? ' team-collect-button--primary' : ''}`}
                  disabled={busy !== null}
                  aria-expanded={extendOpen}
                  onClick={() => setExtendOpen((value) => !value)}
                >
                  연장
                </button>
                <button type="button" className="team-collect-button" disabled={busy !== null} onClick={() => void run('pause', () => endTeamCollect(accountId, 'pause'))}>
                  {busy === 'pause' ? '멈추는 중…' : '일시 정지'}
                </button>
                <button type="button" className="team-collect-button team-collect-button--danger" disabled={busy !== null} onClick={() => void run('stop', () => endTeamCollect(accountId, 'stop'))}>
                  {busy === 'stop' ? '끄는 중…' : '끄기'}
                </button>
              </>
            )}
          </div>

          {extendOpen && phase !== 'paused' && (
            <div className="team-collect-popover__extend" role="group" aria-label="연장할 시간">
              {COLLECT_DURATIONS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className="team-collect-button"
                  disabled={busy !== null}
                  onClick={() => void run('extend', () => startTeamCollect(team, value)).then(() => setExtendOpen(false))}
                >
                  지금부터 {DURATION_LABEL[value]}
                </button>
              ))}
            </div>
          )}

          {status.data && status.data.collecting.length > 0 && (
            <p className="team-collect-popover__meta">
              지금 수집 중: {status.data.collecting.map((m) => m.name ?? '이름 없음').join(', ')}
            </p>
          )}

          {otherDevices.length > 0 && (
            <div className="team-collect-popover__devices">
              <p>내 다른 기기에서 열린 창 {otherDevices.length}개 · {otherDevices.map((w) => `${formatRemaining(new Date(w.expiresAt).getTime() - Date.now())} 남음`).join(', ')}</p>
              <button type="button" className="team-collect-button team-collect-button--danger" disabled={busy !== null} onClick={() => void run('all', () => stopAllDevices(accountId, team.id))}>
                {busy === 'all' ? '끄는 중…' : '모두 끄기'}
              </button>
            </div>
          )}
          {status.isError && <p className="team-collect-popover__meta">다른 기기의 창을 확인하지 못했어요.</p>}

          <button type="button" className="team-collect-link" onClick={() => openSettings({ page: 'workspace', workspaceId: team.id })}>
            제외 목록 편집하기
          </button>
          {error && (
            <p className="team-collect-sheet__error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── 끝날 때 돌아보기 (설계 §8.1-5) ────────────────────────────────

const UNDO_MS = 5000;

export function TeamCollectReview({
  accountId,
  ended,
  pending,
}: {
  accountId: string;
  ended: EndedCollect;
  /** 서버 빼기가 아직 성공하지 못한 창 id */
  pending: string[];
}) {
  const sessions = useQuery({
    queryKey: ['workspaces', ended.workspaceId, 'collect-window', ended.windowId],
    queryFn: () => fetchWindowSessions(ended.workspaceId, ended.windowId),
  });
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ session: Session; state: 'undo' | 'restoring' | 'failed' } | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [withdraw, setWithdraw] = useState<'idle' | 'running' | 'done' | 'failed'>('idle');
  const [extra, setExtra] = useState<Session[]>([]);
  const client = useQueryClient();
  const withdrawPending = pending.includes(ended.windowId);

  useEffect(() => {
    if (toast?.state !== 'undo') return;
    const id = setTimeout(() => setToast(null), UNDO_MS);
    return () => clearTimeout(id);
  }, [toast]);

  const all = [...(sessions.data ?? []), ...extra.filter((s) => !sessions.data?.some((d) => d.id === s.id))];
  // 접히는 중인 행은 공유가 풀린 뒤에도 전환이 끝날 때까지 남긴다.
  const shared = new Set(reviewableSessions(all, ended.workspaceId).map((s) => s.id));
  const visible = all.filter((s) => !removed.has(s.id) && (shared.has(s.id) || leaving.has(s.id)));

  const removeOne = async (session: Session) => {
    setRowError(null);
    setLeaving((prev) => new Set(prev).add(session.id));
    try {
      // 404: 그새 공유가 이미 풀렸다(owner 가 풀었거나 다른 화면에서 뺐다). 빠진 상태이므로 성공으로 본다.
      await unshareSession(ended.workspaceId, session.id).catch((err) => {
        if (!(err instanceof ApiError && err.status === 404)) throw err;
      });
      // 행이 접히는 전환이 끝난 뒤 목록에서 뺀다.
      setTimeout(() => setRemoved((prev) => new Set(prev).add(session.id)), 220);
      setToast({ session, state: 'undo' });
      void client.invalidateQueries({ predicate: (query) => query.queryKey.includes(ended.workspaceId) });
    } catch {
      setLeaving((prev) => {
        const next = new Set(prev);
        next.delete(session.id);
        return next;
      });
      setRowError('팀에서 빼지 못했어요. 다시 시도해 주세요.');
    }
  };

  const undo = async () => {
    if (!toast) return;
    const { session } = toast;
    setToast({ session, state: 'restoring' });
    try {
      await restoreCollectSession(ended.workspaceId, session.id);
      setRemoved((prev) => {
        const next = new Set(prev);
        next.delete(session.id);
        return next;
      });
      setLeaving((prev) => {
        const next = new Set(prev);
        next.delete(session.id);
        return next;
      });
      setToast(null);
      void client.invalidateQueries({ predicate: (query) => query.queryKey.includes(ended.workspaceId) });
    } catch {
      // 409: 그새 팀을 나갔거나 세션이 합쳐졌다. 그사이 노출은 없다(빠진 상태 그대로).
      setToast({ session, state: 'failed' });
    }
  };

  const withdrawRest = async () => {
    setWithdraw('running');
    try {
      const result = await withdrawTeamWindow(accountId, ended.workspaceId, ended.windowId);
      setExtra(result.sessions);
      setWithdraw('done');
    } catch {
      setWithdraw('failed');
    }
  };

  return (
    <section className="team-collect-review" aria-labelledby="team-collect-review-title">
      <header className="team-collect-review__head">
        <h2 id="team-collect-review-title">
          이번 팀 수집: {sessions.isSuccess ? `세션 ${visible.length}개` : '세션 확인 중'}
        </h2>
        <p>{ended.workspaceName}에 공유된 세션이에요. 팀에 남기고 싶지 않은 것은 빼세요.</p>
      </header>

      {sessions.isPending && (
        <p className="team-collect-review__state" role="status">
          <Loader2 size={14} className="team-collect-spin" aria-hidden="true" /> 이번에 모인 세션을 불러오는 중…
        </p>
      )}
      {sessions.isError && (
        <div className="team-collect-review__state" role="alert">
          세션을 불러오지 못했어요.
          <button type="button" className="team-collect-button" onClick={() => void sessions.refetch()}>
            다시 시도
          </button>
        </div>
      )}
      {sessions.isSuccess && visible.length === 0 && (
        <p className="team-collect-review__state">
          팀으로 모인 세션이 아직 없어요. 방문은 몇 분 뒤 세션이 되니, 남기고 싶지 않으면 아래에서 남은 방문을 빼세요.
        </p>
      )}
      {visible.length > 0 && (
        <ul className="team-collect-review__list">
          {visible.map((session) => (
            <li key={session.id} className={`team-collect-review__row${leaving.has(session.id) ? ' is-leaving' : ''}`}>
              <div>
                <strong>{session.title || '제목 없는 세션'}</strong>
                <span>{[...new Set(session.tabs.map((t) => { try { return new URL(t.url).hostname; } catch { return ''; } }).filter(Boolean))].slice(0, 4).join(' · ')}</span>
              </div>
              <button type="button" className="team-collect-button" disabled={leaving.has(session.id)} onClick={() => void removeOne(session)}>
                팀에서 빼기
              </button>
            </li>
          ))}
        </ul>
      )}
      {rowError && (
        <p className="team-collect-sheet__error" role="alert">
          {rowError}
        </p>
      )}

      <footer className="team-collect-review__actions">
        <button
          type="button"
          className="team-collect-button"
          disabled={withdraw === 'running' || withdraw === 'done'}
          aria-busy={withdraw === 'running'}
          onClick={() => void withdrawRest()}
        >
          {withdraw === 'running' && <Loader2 size={14} className="team-collect-spin" aria-hidden="true" />}
          {withdraw === 'running'
            ? '빼는 중…'
            : withdraw === 'done'
              ? '남은 방문을 뺐어요'
              : withdraw === 'failed' || withdrawPending
                ? '아직 빼는 중 · 다시 시도'
                : '남은 방문도 모두 빼기'}
        </button>
        <button type="button" className="team-collect-button team-collect-button--primary" onClick={() => void dismissReview(accountId)}>
          확인
        </button>
      </footer>
      {(withdraw === 'failed' || withdrawPending) && withdraw !== 'done' && (
        <p className="team-collect-review__note" role="status">
          이 기기에 남은 방문은 이미 개인으로 돌렸어요. 서버에 있는 방문은 연결되면 자동으로 다시 빼요.
        </p>
      )}

      {toast && (
        <div className="team-collect-toast" role="status">
          {toast.state === 'failed' ? (
            <span>되돌릴 수 없어요. 그 사이 팀이나 세션이 바뀌었어요.</span>
          ) : (
            <span>‘{toast.session.title || '세션'}’을 팀에서 뺐어요.</span>
          )}
          {toast.state !== 'failed' ? (
            <button type="button" disabled={toast.state === 'restoring'} onClick={() => void undo()}>
              <Undo2 size={13} aria-hidden="true" /> {toast.state === 'restoring' ? '되돌리는 중…' : '되돌리기'}
            </button>
          ) : (
            <button type="button" onClick={() => setToast(null)}>
              확인
            </button>
          )}
        </div>
      )}
    </section>
  );
}
