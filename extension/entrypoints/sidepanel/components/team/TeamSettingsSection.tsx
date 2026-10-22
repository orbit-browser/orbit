import { useState, type FormEvent } from 'react';
import { ChevronRight, Copy } from 'lucide-react';
import type { InviteCode, Workspace } from '../../../../lib/types';
import { useAuth } from '../../../../lib/useAuth';
import { useActiveWorkspace, useWorkspaces } from '../../../../lib/useWorkspaces';
import { useWorkspaceMembers, useWorkspaceMutations } from '../../hooks/useWorkspaces';
import { useUIStore } from '../../store/ui';
import { MemberAvatar } from './MemberAvatar';

const inputClass =
  'min-w-0 flex-1 rounded-md border border-orbit-border bg-orbit-bg px-2 py-1 text-xs text-orbit-text outline-none focus:border-orbit-primary';
const primaryButtonClass =
  'shrink-0 cursor-pointer rounded-md bg-orbit-primary px-2.5 py-1 text-[11px] font-semibold text-white transition hover:brightness-95 disabled:opacity-50';
const quietButtonClass =
  'cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium text-orbit-muted transition hover:bg-orbit-bg hover:text-orbit-text disabled:opacity-50';
const dangerButtonClass =
  'cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium text-orbit-muted transition hover:bg-orbit-danger-soft hover:text-orbit-danger disabled:opacity-50';

function formatExpiry(iso: string): string {
  const date = new Date(iso);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function InviteCodePanel({ workspace }: { workspace: Workspace }) {
  const { issueInvite } = useWorkspaceMutations();
  const showToast = useUIStore((s) => s.showToast);
  const [invite, setInvite] = useState<InviteCode | null>(null);

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      showToast('초대 코드를 복사했어요');
    } catch {
      showToast('복사하지 못했어요. 코드를 직접 선택해 복사해 주세요');
    }
  }

  return (
    <div className="space-y-1.5">
      {invite && (
        <div className="flex items-center gap-1.5 rounded-md bg-orbit-bg px-2 py-1.5">
          <code className="min-w-0 flex-1 select-all truncate text-xs font-semibold text-orbit-text">
            {invite.code}
          </code>
          <button
            type="button"
            onClick={() => void copy(invite.code)}
            aria-label="초대 코드 복사"
            className="shrink-0 cursor-pointer rounded p-1 text-orbit-muted transition hover:text-orbit-text"
          >
            <Copy size={12} />
          </button>
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-[11px] leading-relaxed text-orbit-muted">
          {invite
            ? `${formatExpiry(invite.expiresAt)}까지 쓸 수 있어요. 이 화면을 벗어나면 다시 볼 수 없어요.`
            : '새로 만들면 이전 코드는 더 이상 쓸 수 없어요.'}
        </p>
        <button
          type="button"
          disabled={issueInvite.isPending}
          onClick={() =>
            issueInvite.mutate(workspace.id, {
              onSuccess: setInvite,
              onError: () => showToast('초대 코드를 만들지 못했어요'),
            })
          }
          className={primaryButtonClass}
        >
          {invite ? '다시 만들기' : '초대 코드 만들기'}
        </button>
      </div>
    </div>
  );
}

function TeamPanel({ workspace }: { workspace: Workspace }) {
  const { session } = useAuth();
  const myId = session?.user.id ?? null;
  const members = useWorkspaceMembers(workspace.id);
  const { rename, remove, removeMember } = useWorkspaceMutations();
  const showToast = useUIStore((s) => s.showToast);
  const [draftName, setDraftName] = useState<string | null>(null);
  // 내보내면 서버가 현재 초대 코드를 무효로 한다 — 화면에 남은 옛 코드도 함께 지운다.
  const [inviteKey, setInviteKey] = useState(0);
  const isOwner = workspace.role === 'owner';

  function commitRename() {
    const next = draftName?.trim();
    setDraftName(null);
    if (!next || next === workspace.name) return;
    rename.mutate(
      { workspaceId: workspace.id, name: next },
      {
        onSuccess: () => showToast('팀 이름을 바꿨어요'),
        onError: () => showToast('팀 이름을 바꾸지 못했어요'),
      },
    );
  }

  function deleteTeam() {
    if (
      !window.confirm(
        `"${workspace.name}" 팀을 지울까요?\n공유됐던 세션은 각자의 개인 기록에 그대로 남아요.`,
      )
    ) {
      return;
    }
    remove.mutate(workspace.id, {
      // 지금 범위를 개인으로 돌리는 일은 공용 훅이 한다 — 이 화면은 결과 전에 사라질 수 있다.
      onSuccess: () => showToast('팀을 지웠어요'),
      onError: () => showToast('팀을 지우지 못했어요'),
    });
  }

  function removeUser(userId: string, label: string) {
    const self = userId === myId;
    const message = self
      ? `"${workspace.name}" 팀에서 나갈까요?\n내가 공유한 세션은 팀에서 빠지고 내 개인 기록에는 남아요.`
      : `${label} 님을 팀에서 내보낼까요?\n그 사람이 공유한 세션도 팀에서 빠지고, 지금 초대 코드는 더 이상 쓸 수 없어요.`;
    if (!window.confirm(message)) return;
    removeMember.mutate(
      { workspaceId: workspace.id, userId },
      {
        onSuccess: () => {
          if (self) {
            showToast('팀에서 나왔어요');
            return;
          }
          setInviteKey((key) => key + 1);
          showToast('팀원을 내보냈어요. 초대 코드는 새로 만들어야 해요');
        },
        onError: () => showToast(self ? '팀에서 나가지 못했어요' : '팀원을 내보내지 못했어요'),
      },
    );
  }

  return (
    <div className="space-y-3 px-3 pb-3">
      {isOwner && draftName !== null && (
        <input
          autoFocus
          value={draftName}
          maxLength={60}
          onChange={(event) => setDraftName(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitRename();
            if (event.key === 'Escape') setDraftName(null);
          }}
          aria-label="팀 이름"
          className={inputClass + ' w-full'}
        />
      )}

      <div className="space-y-1">
        <p className="text-[11px] font-semibold text-orbit-muted">팀원</p>
        {members.isLoading ? (
          <p className="text-[11px] text-orbit-muted">불러오는 중…</p>
        ) : members.isError ? (
          <p className="text-[11px] text-orbit-muted">팀원 목록을 불러오지 못했어요</p>
        ) : (
          <ul className="space-y-1">
            {(members.data ?? []).map((member) => (
              <li key={member.userId} className="flex items-center gap-2">
                <MemberAvatar member={member} size={18} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-orbit-text">
                    {member.name ?? member.email ?? '팀원'}
                    {member.userId === myId && <span className="text-orbit-muted"> (나)</span>}
                  </p>
                  {member.email && (
                    <p className="truncate text-[10px] text-orbit-muted">{member.email}</p>
                  )}
                </div>
                <span className="shrink-0 text-[10px] text-orbit-muted">
                  {member.role === 'owner' ? '소유자' : '팀원'}
                </span>
                {isOwner && member.userId !== myId && (
                  <button
                    type="button"
                    disabled={removeMember.isPending}
                    onClick={() =>
                      removeUser(member.userId, member.name ?? member.email ?? '팀원')
                    }
                    className={dangerButtonClass}
                  >
                    내보내기
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {isOwner && <InviteCodePanel key={inviteKey} workspace={workspace} />}

      <div className="flex items-center gap-0.5 border-t border-orbit-border pt-2">
        {isOwner ? (
          <>
            <button type="button" onClick={() => setDraftName(workspace.name)} className={quietButtonClass}>
              이름 바꾸기
            </button>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={deleteTeam}
              className={dangerButtonClass + ' ml-auto'}
            >
              팀 삭제
            </button>
          </>
        ) : (
          myId && (
            <button
              type="button"
              disabled={removeMember.isPending}
              onClick={() => removeUser(myId, workspace.name)}
              className={dangerButtonClass + ' ml-auto'}
            >
              팀 나가기
            </button>
          )
        )}
      </div>
    </div>
  );
}

/**
 * 팀 만들기·참여·관리. 팀에는 사용자가 고른 세션만 공유되고 개인 기록은 그대로 개인 것이다.
 */
export function TeamSettingsSection() {
  const workspacesQuery = useWorkspaces();
  const workspaces = workspacesQuery.data ?? [];
  const { select } = useActiveWorkspace();
  const { create, join } = useWorkspaceMutations();
  const showToast = useUIStore((s) => s.showToast);
  const [newName, setNewName] = useState('');
  const [code, setCode] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  function submitCreate(event: FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    create.mutate(name, {
      onSuccess: (workspace) => {
        setNewName('');
        setOpenId(workspace.id);
        showToast(`${workspace.name} 팀을 만들었어요`);
      },
      onError: () => showToast('팀을 만들지 못했어요'),
    });
  }

  function submitJoin(event: FormEvent) {
    event.preventDefault();
    const value = code.trim();
    if (!value) return;
    join.mutate(value, {
      onSuccess: (workspace) => {
        setCode('');
        select(workspace.id);
        showToast(`${workspace.name} 팀에 참여했어요`);
      },
      onError: () => showToast('초대 코드가 맞지 않거나 만료됐어요'),
    });
  }

  return (
    <section className="space-y-2">
      <p className="text-xs font-semibold text-orbit-muted">팀</p>
      <div className="divide-y divide-orbit-border rounded-orbit-card border border-orbit-border bg-orbit-surface">
        {workspacesQuery.isError && (
          <p className="px-3 py-2.5 text-xs text-orbit-muted">팀 목록을 불러오지 못했어요</p>
        )}

        {workspaces.map((workspace) => {
          const open = openId === workspace.id;
          return (
            <div key={workspace.id}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : workspace.id)}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left"
              >
                <span
                  aria-hidden
                  style={{ backgroundColor: workspace.hue }}
                  className="h-2 w-2 shrink-0 rounded-full"
                />
                <span className="min-w-0 flex-1 truncate text-sm">{workspace.name}</span>
                <span className="shrink-0 text-[11px] text-orbit-muted">
                  {workspace.role === 'owner' ? '소유자' : '팀원'} · {workspace.memberCount}명
                </span>
                <ChevronRight
                  size={13}
                  className={`shrink-0 text-orbit-muted transition ${open ? 'rotate-90' : ''}`}
                />
              </button>
              {open && <TeamPanel workspace={workspace} />}
            </div>
          );
        })}

        <form onSubmit={submitCreate} className="flex items-center gap-2 px-3 py-2.5">
          <input
            value={newName}
            maxLength={60}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="새 팀 이름"
            aria-label="새 팀 이름"
            className={inputClass}
          />
          <button type="submit" disabled={create.isPending || !newName.trim()} className={primaryButtonClass}>
            만들기
          </button>
        </form>

        <form onSubmit={submitJoin} className="flex items-center gap-2 px-3 py-2.5">
          <input
            value={code}
            maxLength={64}
            onChange={(event) => setCode(event.target.value)}
            placeholder="받은 초대 코드"
            aria-label="초대 코드"
            className={inputClass}
          />
          <button type="submit" disabled={join.isPending || !code.trim()} className={primaryButtonClass}>
            참여
          </button>
        </form>
      </div>
      <p className="text-[11px] leading-relaxed text-orbit-muted">
        팀에는 내가 고른 세션만 공유돼요. 개인 기록은 그대로 나만 볼 수 있어요.
      </p>
    </section>
  );
}
