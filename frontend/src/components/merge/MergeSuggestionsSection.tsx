import { useState } from 'react';
import { GitMerge, ArrowRight } from 'lucide-react';
import {
  useMergeSuggestions,
  useMergeSessions,
  useUnmergeSessions,
} from '../../hooks/useMergeSuggestions';
import { useSettings, useUpdateSettings } from '../../hooks/useSettings';
import { useUIStore } from '../../store/ui';
import type { MergeSuggestion } from '../../lib/types';

interface MergeVars {
  survivorId: string;
  absorbedId: string;
}

function AutoMergeToggle() {
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  const showToast = useUIStore((s) => s.showToast);
  if (!settings) return null;
  const on = settings.autoMergeEnabled;

  function toggle() {
    update.mutate(
      { autoMergeEnabled: !on },
      { onSuccess: (d) => showToast(d.autoMergeEnabled ? '자동 병합을 켰어요' : '자동 병합을 껐어요') },
    );
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={toggle}
      disabled={update.isPending}
      title="켜면 다음 동기화에서 '명백한 중복'(제목까지 거의 같은 세션)만 자동 병합돼요. 항상 되돌릴 수 있어요."
      className="flex items-center gap-2 disabled:opacity-50"
    >
      <span className="text-[13px] text-orbit-muted">자동 병합</span>
      <span
        className={[
          'relative h-5 w-9 rounded-full transition',
          on ? 'bg-orbit-primary' : 'bg-black/15',
        ].join(' ')}
      >
        <span
          className={[
            'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition',
            on ? 'translate-x-4' : '',
          ].join(' ')}
        />
      </span>
    </button>
  );
}

/**
 * "병합 제안" 섹션 — GET /sessions/merge-suggestions (docs/merge-design.md §6, P4).
 * 같은 주제로 쪼개진 세션 쌍을 제안하고, 사용자가 확인하면 병합한다(자동 병합 금지 — 실행은 항상 클릭).
 * 백엔드 미준비/실패/제안 없음이면 섹션을 조용히 숨긴다(AnalyticsSection과 동일 방어 패턴).
 */
export function MergeSuggestionsSection() {
  const { data } = useMergeSuggestions();
  const { data: settings, isLoading: settingsLoading, isError: settingsError } = useSettings();
  const merge = useMergeSessions();
  const unmerge = useUnmergeSessions();
  const showToast = useUIStore((s) => s.showToast);
  const [bulkRunning, setBulkRunning] = useState(false);

  // 설정 엔드포인트가 없으면(백엔드 구버전) 섹션 전체를 숨긴다(독립 배포 방어).
  if (settingsLoading || settingsError || !settings) return null;

  const suggestions = data ?? [];
  // 조용한 상태(자동병합 OFF + 제안 없음)에서는 숨긴다. 자동병합이 켜져 있으면 끌 수 있도록 항상 노출.
  if (!settings.autoMergeEnabled && suggestions.length === 0) return null;

  const busy = merge.isPending || bulkRunning;

  function handleMerge(s: MergeSuggestion) {
    const ok = window.confirm(
      `"${s.absorbedTitle}" 세션을 "${s.survivorTitle}"에 병합할까요?`,
    );
    if (!ok) return;
    const vars = { survivorId: s.survivorId, absorbedId: s.absorbedId };
    merge.mutate(vars, {
      onSuccess: () =>
        showToast('세션을 병합했어요', {
          label: '되돌리기',
          onClick: () =>
            unmerge.mutate(vars, { onSuccess: () => showToast('병합을 되돌렸어요') }),
        }),
      onError: () => showToast('병합에 실패했어요'),
    });
  }

  // 일괄병합 — 제안된 쌍을 순차 병합. 한 배치에서 이미 소비된 세션(생존/피흡수)이 다시 등장하면
  // 건너뛴다(예: 한 세션이 두 제안에 걸친 경우 stale 충돌 방지). 성공분은 "모두 되돌리기"로 일괄 undo.
  async function handleMergeAll() {
    if (suggestions.length === 0) return;
    const ok = window.confirm(
      `제안된 ${suggestions.length}개 쌍을 모두 병합할까요? 각 병합은 되돌릴 수 있어요.`,
    );
    if (!ok) return;

    setBulkRunning(true);
    const consumed = new Set<string>();
    const done: MergeVars[] = [];
    let skipped = 0;
    try {
      for (const s of suggestions) {
        if (consumed.has(s.survivorId) || consumed.has(s.absorbedId)) {
          skipped += 1;
          continue;
        }
        const vars = { survivorId: s.survivorId, absorbedId: s.absorbedId };
        try {
          await merge.mutateAsync(vars);
          consumed.add(s.survivorId);
          consumed.add(s.absorbedId);
          done.push(vars);
        } catch {
          skipped += 1;
        }
      }
    } finally {
      setBulkRunning(false);
    }

    const summary = `${done.length}개 병합했어요${skipped ? `, ${skipped}개 건너뜀` : ''}`;
    showToast(
      summary,
      done.length
        ? {
            label: '모두 되돌리기',
            onClick: async () => {
              for (const vars of [...done].reverse()) {
                try {
                  await unmerge.mutateAsync(vars);
                } catch {
                  /* 개별 실패는 무시하고 나머지 계속 */
                }
              }
              showToast('병합을 되돌렸어요');
            },
          }
        : undefined,
    );
  }

  return (
    <div className="mt-16 w-full max-w-[860px]">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitMerge size={16} className="text-orbit-primary" />
          <h2 className="text-[15px] font-semibold text-orbit-text">병합 제안</h2>
          {suggestions.length > 0 && (
            <span className="rounded-full bg-orbit-primary/10 px-2 py-0.5 text-[11px] font-medium text-orbit-primary">
              {suggestions.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <AutoMergeToggle />
          {suggestions.length > 1 && (
            <button
              type="button"
              onClick={handleMergeAll}
              disabled={busy}
              className="rounded-lg border border-orbit-border px-3 py-1.5 text-[13px] font-medium text-orbit-text transition hover:bg-black/[0.03] disabled:opacity-50"
            >
              {bulkRunning ? '병합 중…' : '모두 병합'}
            </button>
          )}
        </div>
      </div>
      {settings.autoMergeEnabled && (
        <p className="mb-3 text-[12px] text-orbit-muted">
          자동 병합이 켜져 있어요 — 다음 동기화에서 제목까지 거의 같은 중복만 자동으로 합쳐지고, 나머지는 아래에서 직접 확인해요.
        </p>
      )}
      {suggestions.length === 0 ? (
        <p className="rounded-2xl border border-orbit-border bg-orbit-surface px-4 py-6 text-center text-sm text-orbit-muted">
          지금은 병합을 제안할 만한 중복 세션이 없어요.
        </p>
      ) : (
      <div className="grid grid-cols-1 gap-3">
        {suggestions.map((s) => (
          <div
            key={`${s.survivorId}:${s.absorbedId}`}
            className="flex flex-col gap-3 rounded-2xl border border-orbit-border bg-orbit-surface p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2 text-sm text-orbit-text">
                <span className="truncate font-medium">{s.absorbedTitle}</span>
                <ArrowRight size={14} className="shrink-0 text-orbit-muted" />
                <span className="truncate font-semibold">{s.survivorTitle}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-orbit-muted">
                  유사도 {Math.round(s.score * 100)}%
                </span>
                {s.keywordOverlap.slice(0, 4).map((kw) => (
                  <span
                    key={kw}
                    className="rounded-md bg-black/[0.05] px-1.5 py-0.5 text-[11px] text-orbit-muted"
                  >
                    {kw}
                  </span>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleMerge(s)}
              disabled={busy}
              className="shrink-0 rounded-lg bg-orbit-primary px-3.5 py-1.5 text-[13px] font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            >
              병합
            </button>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}
