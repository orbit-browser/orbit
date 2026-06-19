import { useState } from 'react';
import { Send } from 'lucide-react';

interface Props {
  onSubmit: (query: string) => void;
  placeholder?: string;
}

export function SearchInput({ onSubmit, placeholder }: Props) {
  const [value, setValue] = useState('');

  function submit() {
    const q = value.trim();
    if (q) onSubmit(q);
  }

  return (
    <div className="flex items-center gap-2 rounded-xl border border-orbit-border bg-orbit-surface px-3 py-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        placeholder={placeholder ?? '자연어로 세션을 검색해 보세요'}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-orbit-muted"
      />
      <button
        type="button"
        onClick={submit}
        title="검색"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orbit-primary text-white transition hover:brightness-95"
      >
        <Send size={15} />
      </button>
    </div>
  );
}
