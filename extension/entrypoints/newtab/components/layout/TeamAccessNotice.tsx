import { useEffect, useState } from 'react';
import { onTeamAccessLost, teamLabel } from '../../../../lib/useWorkspaces';

const AUTO_HIDE_MS = 8000;

/** 보던 팀에서 내보내졌거나 팀이 사라져 내 Orbit 으로 돌아왔음을 알린다. 홈·아틀라스가 함께 쓴다. */
export function TeamAccessNotice() {
  const [teamName, setTeamName] = useState<string | null>(null);

  useEffect(() => onTeamAccessLost(setTeamName), []);

  useEffect(() => {
    if (!teamName) return;
    const id = setTimeout(() => setTeamName(null), AUTO_HIDE_MS);
    return () => clearTimeout(id);
  }, [teamName]);

  if (!teamName) return null;
  return (
    <div className="team-access-notice" role="status">
      <span>
        <strong>{teamLabel(teamName)}</strong>에 더 이상 접근할 수 없어요. 내 Orbit으로 돌아왔어요.
      </span>
      <button type="button" onClick={() => setTeamName(null)}>
        확인
      </button>
    </div>
  );
}
