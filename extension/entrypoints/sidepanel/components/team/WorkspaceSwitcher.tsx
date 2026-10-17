import { useActiveWorkspace } from '../../../../lib/useWorkspaces';

/**
 * 개인 기록과 팀 사이를 오가는 선택. 팀이 하나도 없으면 그리지 않는다 — 팀 만들기·참여는 설정에 있다.
 * 네이티브 select 를 쓴다: 키보드·스크린리더 동작을 그대로 얻고, 좁은 사이드패널에서도 펼침 목록이 잘리지 않는다.
 */
export function WorkspaceSwitcher({ onChange }: { onChange?: (workspaceId: string | null) => void }) {
  const { workspaces, scopeId, select } = useActiveWorkspace();
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
      className="max-w-[7.5rem] cursor-pointer truncate rounded-md border border-orbit-border/50 bg-orbit-bg px-1.5 py-1 text-[11px] font-semibold text-orbit-text outline-none focus:border-orbit-primary"
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
