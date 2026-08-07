import { useState } from 'react';
import { ArrowRight, GitMerge, Loader2 } from 'lucide-react';
import type { MergeSuggestion } from '../../../lib/types';
import type { MergePair } from '../../../lib/merge';
import { isMergePairAvailable, markMergePairConsumed } from '../../../lib/merge';
import {
  useMergeSessions,
  useMergeSuggestions,
  useUnmergeSessions,
} from '../hooks/useMergeSuggestions';
import { useUIStore } from '../store/ui';

export function MergeSuggestionsSection() {
  const { data, isLoading, isError } = useMergeSuggestions();
  const merge = useMergeSessions();
  const unmerge = useUnmergeSessions();
  const showToast = useUIStore((s) => s.showToast);
  const [bulkRunning, setBulkRunning] = useState(false);

  const suggestions = data ?? [];
  if (isLoading || isError || suggestions.length === 0) return null;

  const busy = merge.isPending || bulkRunning;

  function undoPair(pair: MergePair) {
    unmerge.mutate(pair, {
      onSuccess: () => showToast('병합을 되돌렸어요'),
      onError: () => showToast('병합을 되돌리지 못했어요'),
    });
  }

  function handleMerge(suggestion: MergeSuggestion) {
    const confirmed = window.confirm(
      `"${suggestion.absorbedTitle}" 세션을 "${suggestion.survivorTitle}"에 병합할까요?`,
    );
    if (!confirmed) return;

    const pair = {
      survivorId: suggestion.survivorId,
      absorbedId: suggestion.absorbedId,
    };
    merge.mutate(pair, {
      onSuccess: () =>
        showToast('세션을 병합했어요', {
          label: '되돌리기',
          onClick: () => undoPair(pair),
        }),
      onError: () => showToast('병합에 실패했어요'),
    });
  }

  async function undoAll(done: MergePair[]) {
    let failed = 0;
    for (const pair of [...done].reverse()) {
      try {
        await unmerge.mutateAsync(pair);
      } catch {
        failed += 1;
      }
    }
    showToast(failed ? `${failed}개 병합을 되돌리지 못했어요` : '모든 병합을 되돌렸어요');
  }

  async function handleMergeAll() {
    const confirmed = window.confirm(
      `제안된 ${suggestions.length}개 쌍을 모두 병합할까요? 각 병합은 되돌릴 수 있어요.`,
    );
    if (!confirmed) return;

    setBulkRunning(true);
    const consumed = new Set<string>();
    const done: MergePair[] = [];
    let skipped = 0;
    try {
      for (const suggestion of suggestions) {
        if (!isMergePairAvailable(consumed, suggestion)) {
          skipped += 1;
          continue;
        }
        const pair = {
          survivorId: suggestion.survivorId,
          absorbedId: suggestion.absorbedId,
        };
        try {
          await merge.mutateAsync(pair);
          markMergePairConsumed(consumed, pair);
          done.push(pair);
        } catch {
          skipped += 1;
        }
      }
    } finally {
      setBulkRunning(false);
    }

    showToast(
      `${done.length}개 병합했어요${skipped ? `, ${skipped}개 건너뜀` : ''}`,
      done.length
        ? {
            label: '모두 되돌리기',
            onClick: () => void undoAll(done),
          }
        : undefined,
    );
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <GitMerge size={14} className="text-orbit-primary" />
          <p className="text-xs font-semibold text-orbit-muted">병합 제안</p>
          <span className="rounded-full bg-orbit-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-orbit-primary">
            {suggestions.length}
          </span>
        </div>
        {suggestions.length > 1 && (
          <button
            type="button"
            onClick={() => void handleMergeAll()}
            disabled={busy}
            className="cursor-pointer rounded-full border border-orbit-border px-2.5 py-1 text-[11px] font-semibold text-orbit-text transition hover:border-orbit-primary/40 hover:text-orbit-primary disabled:cursor-default disabled:opacity-50"
          >
            {bulkRunning ? '병합 중…' : '모두 병합'}
          </button>
        )}
      </div>

      <div className="space-y-2">
        {suggestions.map((suggestion) => (
          <div
            key={`${suggestion.survivorId}:${suggestion.absorbedId}`}
            className="rounded-orbit-card border border-orbit-border bg-orbit-surface p-3"
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5 text-xs text-orbit-text">
                  <span className="truncate font-medium">{suggestion.absorbedTitle}</span>
                  <ArrowRight size={12} className="shrink-0 text-orbit-muted" />
                  <span className="truncate font-semibold">{suggestion.survivorTitle}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  <span className="text-[10px] text-orbit-muted">
                    유사도 {Math.round(suggestion.score * 100)}%
                  </span>
                  {suggestion.keywordOverlap.slice(0, 3).map((keyword) => (
                    <span
                      key={keyword}
                      className="rounded bg-orbit-bg px-1.5 py-0.5 text-[10px] text-orbit-muted"
                    >
                      {keyword}
                    </span>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleMerge(suggestion)}
                disabled={busy}
                className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-orbit-primary px-2.5 py-1 text-[11px] font-semibold text-white transition hover:opacity-90 disabled:cursor-default disabled:opacity-50"
              >
                {merge.isPending ? <Loader2 size={11} className="animate-spin" /> : null}
                병합
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
