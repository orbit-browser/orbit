import { Loader2, RefreshCw, Radio, Sparkles } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { useSyncStatus, triggerManualSync } from '../hooks/useSyncStatus';
import { useSettingsStore } from '../store/settings';
import { useUIStore } from '../store/ui';

function formatLastSync(iso: string | null): string {
  if (!iso) return '아직 없음';
  const d = new Date(iso);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay ? time : `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

// 타임라인 홈 상단 카드 — 수집 opt-in 상태에 따라 온보딩 안내 또는 오늘 수집 현황을 보여준다.
// 계약 근거: docs/IA.md "타임라인 홈", docs/target-architecture.md §6(opt-in 원탭 활성화).
export function SyncStatusCard() {
  const { data: status } = useSyncStatus();
  const collectionEnabled = useSettingsStore((s) => s.collectionEnabled);
  const setCollectionEnabled = useSettingsStore((s) => s.setCollectionEnabled);
  const showToast = useUIStore((s) => s.showToast);

  const { mutate: syncNow, isPending: isSyncing } = useMutation({
    mutationFn: triggerManualSync,
    onSuccess: () => showToast('동기화를 시작했어요'),
    onError: () => showToast('동기화 요청에 실패했어요'),
  });

  if (!collectionEnabled) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-orbit-primary/30 bg-orbit-primary-soft p-3.5">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="shrink-0 text-orbit-primary" />
          <p className="text-sm font-semibold text-orbit-text">탐색 기록을 자동으로 모아볼까요?</p>
        </div>
        <p className="text-xs leading-relaxed text-orbit-muted">
          방문한 페이지를 시간순으로 기록해 나중에 다시 찾을 수 있게 해줘요. 은행·로그인 등
          민감한 도메인은 자동으로 제외돼요.
        </p>
        <button
          type="button"
          onClick={() => {
            setCollectionEnabled(true);
            showToast('탐색 기록 수집을 켰어요');
          }}
          className="self-start rounded-lg bg-orbit-primary px-3 py-1.5 text-xs font-bold text-white transition hover:brightness-95 cursor-pointer"
        >
          수집 켜기
        </button>
      </div>
    );
  }

  const pendingCount = status?.pendingCount ?? 0;
  const todayCount = status?.todayCount ?? 0;

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-orbit-border bg-orbit-surface p-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Radio size={13} className="text-orbit-primary" />
          <span className="text-xs font-semibold text-orbit-text">탐색 기록 수집 중</span>
        </div>
        <button
          type="button"
          onClick={() => syncNow()}
          disabled={isSyncing}
          className="flex items-center gap-1 rounded-md bg-orbit-bg px-2 py-1 text-[11px] font-bold text-orbit-text transition hover:bg-orbit-border/60 disabled:opacity-50 cursor-pointer"
        >
          {isSyncing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          지금 저장
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-sm font-bold text-orbit-text">{todayCount}</p>
          <p className="text-[10px] text-orbit-muted">오늘 방문</p>
        </div>
        <div>
          <p className="text-sm font-bold text-orbit-text">{pendingCount}</p>
          <p className="text-[10px] text-orbit-muted">미처리</p>
        </div>
        <div>
          <p className="text-sm font-bold text-orbit-text">
            {formatLastSync(status?.lastSyncAt ?? null)}
          </p>
          <p className="text-[10px] text-orbit-muted">마지막 동기화</p>
        </div>
      </div>
    </div>
  );
}
