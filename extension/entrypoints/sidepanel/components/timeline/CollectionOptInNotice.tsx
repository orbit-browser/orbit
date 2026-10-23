import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import {
  AI_DISCLOSURE,
  CONSENT_KEY,
  getCollectionConsent,
  needsReconsent,
  RECONSENT_NOTICE,
} from '../../../../lib/settings';
import { useAuth } from '../../../../lib/useAuth';
import { useSettingsStore } from '../../store/settings';
import { useUIStore } from '../../store/ui';

/** 지금 계정이 옛 동의 문구에 동의해 수집이 멈춘 상태인지. 동의 저장소 변경을 따라간다. */
export function useNeedsReconsent(): boolean {
  const { session } = useAuth();
  const accountId = session?.user.id ?? null;
  const [value, setValue] = useState(false);
  useEffect(() => {
    if (!accountId) {
      setValue(false);
      return;
    }
    let alive = true;
    const load = () => void getCollectionConsent().then((consent) => alive && setValue(needsReconsent(consent, accountId)));
    load();
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && CONSENT_KEY in changes) load();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, [accountId]);
  return value;
}

/**
 * 수집이 꺼져 있을 때만 나오는 opt-in 안내.
 *
 * 상시 카드가 아니라 조건부 화면이다 — 수집이 켜져 있으면 아무것도 그리지 않으므로
 * 평소에는 목록의 세로 공간을 전혀 쓰지 않는다.
 * `compact` 는 기록이 이미 남아 있을 때 목록 위에 얹는 짧은 형태.
 * 수집 동의는 계정별이라 다른 계정이 로그인하면 이 안내가 다시 나온다. 동의하는 자리이므로
 * 짧은 형태에도 외부 AI 전송 범위(AI_DISCLOSURE)를 빼지 않는다.
 */
export function CollectionOptInNotice({
  compact = false,
  onEnabled,
}: {
  compact?: boolean;
  onEnabled?: () => void;
}) {
  const setCollectionEnabled = useSettingsStore((s) => s.setCollectionEnabled);
  const showToast = useUIStore((s) => s.showToast);
  // 옛 문구에 동의했던 계정은 "왜 멈췄는지"를 먼저 말한다(동의 문구 버전 2).
  const reconsent = useNeedsReconsent();

  function enable() {
    setCollectionEnabled(true);
    showToast(reconsent ? '바뀐 안내에 동의하고 수집을 다시 켰어요' : '탐색 기록 수집을 켰어요');
    onEnabled?.();
  }

  if (compact) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-orbit-primary/30 bg-orbit-primary-soft px-3 py-2">
        <Sparkles size={13} className="shrink-0 text-orbit-primary" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] text-orbit-text">
            {reconsent ? RECONSENT_NOTICE : '수집이 꺼져 있어 새 기록이 쌓이지 않아요'}
          </p>
          <p className="mt-0.5 text-[10px] leading-snug text-orbit-muted">{AI_DISCLOSURE}</p>
        </div>
        <button
          type="button"
          onClick={enable}
          className="shrink-0 cursor-pointer rounded-md bg-orbit-primary px-2 py-1 text-[11px] font-bold text-white transition hover:brightness-95"
        >
          {reconsent ? '동의하고 켜기' : '수집 켜기'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <Sparkles size={22} className="text-orbit-primary" />
      <p className="text-sm font-semibold text-orbit-text">
        {reconsent ? RECONSENT_NOTICE : '탐색 기록을 자동으로 모아볼까요?'}
      </p>
      <p className="text-xs leading-relaxed text-orbit-muted">
        방문한 페이지를 시간순으로 기록해 나중에 다시 찾을 수 있게 해줘요. 은행·로그인 등 민감한
        페이지는 본문을 저장하지 않고 방문(제목·주소)만 남겨요.
      </p>
      <p className="text-xs leading-relaxed text-orbit-muted">{AI_DISCLOSURE}</p>
      <button
        type="button"
        onClick={enable}
        className="mt-1 cursor-pointer rounded-lg bg-orbit-primary px-3.5 py-2 text-xs font-bold text-white transition hover:brightness-95"
      >
        {reconsent ? '동의하고 다시 켜기' : '수집 켜기'}
      </button>
    </div>
  );
}
