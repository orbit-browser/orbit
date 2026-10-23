import { useEffect, useState } from 'react';
import { getSettings, subscribeSettings } from '../../../../lib/settings';
import { enableTabSnapshots, PAGE_IMAGE_NOTICE, SNAPSHOT_NOTICE } from '../../../../lib/tab-snapshots';

type State = 'loading' | 'off' | 'asking' | 'denied' | 'on';

/**
 * 미리보기가 꺼져 있으면 첫 화면(홈·아틀라스 갤러리 위)에 한 줄로 켜기를 권한다. 카드가 회색 칸뿐인 까닭을
 * 설정 깊숙이 찾아가지 않아도 알 수 있게 한다(대표 2026-10-20 "알아서 찍으면 되는 것 아니냐").
 * 버튼 한 번 = 크롬 권한 요청(같은 클릭 안에서). 거절하면 카드가 남고, 켜지면 사라진다.
 */
export function SnapshotPrompt({ placement }: { placement: 'home' | 'atlas' }) {
  const [state, setState] = useState<State>('loading');

  useEffect(() => {
    let alive = true;
    void getSettings().then((s) => alive && setState(s.tabSnapshotsEnabled ? 'on' : 'off'));
    const unsubscribe = subscribeSettings((s) => alive && setState((prev) => (s.tabSnapshotsEnabled ? 'on' : prev === 'on' ? 'off' : prev)));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  if (state === 'loading' || state === 'on') return null;

  const turnOn = () => {
    setState('asking');
    // 권한 요청은 클릭 처리기 안에서 곧바로 불러야 크롬이 받아 준다.
    void enableTabSnapshots().then((granted) => setState(granted ? 'on' : 'denied'));
  };

  return (
    <div className={`snapshot-prompt snapshot-prompt--${placement}`} role="region" aria-label="실제 페이지 미리보기">
      <span className="snapshot-prompt__text">
        <strong>실제 페이지 미리보기 켜기</strong> · 기기 안에만 저장돼요
        {/* 보안 검토: 켜기 전에 실제 범위(목록 밖 사이트도 찍힘, 지난 페이지는 다시 열어 받음)를 같이 보인다. */}
        <span className="snapshot-prompt__detail">
          {SNAPSHOT_NOTICE} {PAGE_IMAGE_NOTICE}
        </span>
        {state === 'denied' && (
          <span className="snapshot-prompt__note" role="status">
            {' '}— 권한을 받지 못해 켜지 않았어요. 다시 누르면 크롬이 한 번 더 물어요.
          </span>
        )}
      </span>
      <button type="button" className="snapshot-prompt__button" disabled={state === 'asking'} onClick={turnOn}>
        {state === 'asking' ? '권한 묻는 중…' : '켜기'}
      </button>
    </div>
  );
}
