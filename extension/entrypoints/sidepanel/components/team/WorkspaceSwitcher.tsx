import { RotateCw } from 'lucide-react';
import { useActiveWorkspace, useWorkspaces } from '../../../../lib/useWorkspaces';

/**
 * 개인 기록과 팀 사이를 오가는 선택. 팀이 하나도 없으면 그리지 않는다 — 팀 만들기·참여는 설정에 있다.
 * 네이티브 select 를 쓴다: 키보드·스크린리더 동작을 그대로 얻고, 좁은 사이드패널에서도 펼침 목록이 잘리지 않는다.
 */
export function WorkspaceSwitcher({ onChange }: { onChange?: (workspaceId: string | null) => void }) {
  const { workspaces, scopeId, select } = useActiveWorkspace();
  const workspacesQuery = useWorkspaces();
  // 목록을 못 받으면 선택이 조용히 사라져 지금 어느 범위인지 알 수 없다 — 실패를 드러내고 다시 받게 한다.
  if (workspacesQuery.isError) {
    return (
      <button
        type="button"
        role="alert"
        title="팀 목록을 불러오지 못했어요. 눌러서 다시 시도해요"
        disabled={workspacesQuery.isFetching}
        onClick={() => void workspacesQuery.refetch()}
        className="flex cursor-pointer items-center gap-1 rounded-md border border-orbit-danger/40 px-1.5 py-1 text-[11px] font-semibold text-orbit-danger transition hover:bg-orbit-danger-soft disabled:opacity-50"
      >
        <RotateCw size={11} className={workspacesQuery.isFetching ? 'animate-spin' : undefined} />
        팀 목록 오류 · 다시 시도
      </button>
    );
  }
  if (workspaces.length === 0) return null;

  return (
    <select
      aria-label="보고 있는 기록"
      title="개인 기록과 팀 사이를 전환해요"
      value={scopeId ?? ''}
      onChange={(event) => {
        const next = event.target.value || null;
        select(next);
        onChange?.(next);
      }}
      className="max-w-[7.5rem] cursor-pointer truncate rounded-md border border-orbit-border/50 bg-orbit-bg px-1.5 py-1 text-[11px] font-semibold text-orbit-text outline-none transition hover:border-orbit-primary-muted focus:border-orbit-primary"
    >
      <option value="">개인</option>
      {workspaces.map((workspace) => (
        <option key={workspace.id} value={workspace.id}>
          {workspace.name}
        </option>
      ))}
    </select>
  );
}
