import { MergeSuggestionsSection } from '../components/MergeSuggestionsSection';
import { Sheet } from '../components/control/Sheet';
import { useMergeSuggestions } from '../hooks/useMergeSuggestions';

export function MergeSheet() {
  const { data } = useMergeSuggestions();
  const count = data?.length ?? 0;

  return (
    <Sheet title="세션 병합">
      <div className="p-3">
        {count === 0 ? (
          <p className="py-12 text-center text-xs text-orbit-muted">
            병합할 만한 세션이 없어요
          </p>
        ) : (
          <MergeSuggestionsSection />
        )}
      </div>
    </Sheet>
  );
}
