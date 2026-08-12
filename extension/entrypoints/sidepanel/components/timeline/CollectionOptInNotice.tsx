import { Sparkles } from 'lucide-react';
import { useSettingsStore } from '../../store/settings';
import { useUIStore } from '../../store/ui';

/**
 * 수집이 꺼져 있을 때만 나오는 opt-in 안내.
 *
 * 상시 카드가 아니라 조건부 화면이다 — 수집이 켜져 있으면 아무것도 그리지 않으므로
 * 평소에는 목록의 세로 공간을 전혀 쓰지 않는다.
 * `compact` 는 기록이 이미 남아 있을 때 목록 위에 얹는 한 줄 형태.
 */
export function CollectionOptInNotice({ compact = false }: { compact?: boolean }) {
  const setCollectionEnabled = useSettingsStore((s) => s.setCollectionEnabled);
  const showToast = useUIStore((s) => s.showToast);

  function enable() {
    setCollectionEnabled(true);
    showToast('탐색 기록 수집을 켰어요');
  }

  if (compact) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-orbit-primary/30 bg-orbit-primary-soft px-3 py-2">
        <Sparkles size={13} className="shrink-0 text-orbit-primary" />
        <span className="min-w-0 flex-1 truncate text-[11px] text-orbit-text">
          수집이 꺼져 있어 새 기록이 쌓이지 않아요
        </span>
        <button
          type="button"
          onClick={enable}
          className="shrink-0 cursor-pointer rounded-md bg-orbit-primary px-2 py-1 text-[11px] font-bold text-white transition hover:brightness-95"
        >
          켜기
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <Sparkles size={22} className="text-orbit-primary" />
      <p className="text-sm font-semibold text-orbit-text">탐색 기록을 자동으로 모아볼까요?</p>
      <p className="text-xs leading-relaxed text-orbit-muted">
        방문한 페이지를 시간순으로 기록해 나중에 다시 찾을 수 있게 해줘요. 은행·로그인 등 민감한
        도메인은 자동으로 제외돼요.
      </p>
      <button
        type="button"
        onClick={enable}
        className="mt-1 cursor-pointer rounded-lg bg-orbit-primary px-3.5 py-2 text-xs font-bold text-white transition hover:brightness-95"
      >
        수집 켜기
      </button>
    </div>
  );
}
