import { useEffect, useState, type ReactNode } from 'react';
import { onTeamAccessLost, teamLabel } from '../../../../lib/useWorkspaces';
import { onTeamSessionsUnshared } from '../../hooks/useAtlasData';

const AUTO_HIDE_MS = 8000;

/**
 * 팀 화면이 바뀐 까닭을 알린다 — 보던 팀에서 내보내졌거나 팀이 사라져 내 Orbit 으로 돌아왔을 때,
 * 또는 보던 팀 세션의 공유가 풀려 화면에서 빠졌을 때. 홈·아틀라스가 함께 쓴다.
 */
export function TeamAccessNotice() {
  const [message, setMessage] = useState<ReactNode>(null);

  useEffect(
    () =>
      onTeamAccessLost((name) =>
        setMessage(
          <>
            <strong>{teamLabel(name)}</strong>에 더 이상 접근할 수 없어요. 내 Orbit으로 돌아왔어요.
          </>,
        ),
      ),
    [],
  );
  useEffect(
    () => onTeamSessionsUnshared((count) => setMessage(`공유가 해제된 세션 ${count}개가 팀 화면에서 빠졌어요.`)),
    [],
  );

  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(null), AUTO_HIDE_MS);
    return () => clearTimeout(id);
  }, [message]);

  if (!message) return null;
  return (
    <div className="team-access-notice" role="status">
      <span>{message}</span>
      <button type="button" onClick={() => setMessage(null)}>
        확인
      </button>
    </div>
  );
}
