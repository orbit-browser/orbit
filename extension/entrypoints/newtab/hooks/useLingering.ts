import { useEffect, useState } from 'react';

/**
 * 값이 사라져도 닫힘 전환이 끝날 때까지 마지막 값을 붙잡아 둔다. `{open && …}`로 바로 언마운트하면
 * 닫힐 때 아무 전환이 보이지 않는다. closing 동안 `data-state="closed"`를 걸어 CSS 가 사라지는 모습을 그린다.
 */
export function useLingering<T>(value: T | null, ms = 120): { shown: T | null; closing: boolean } {
  const [last, setLast] = useState<T | null>(value);

  useEffect(() => {
    if (value !== null) {
      setLast(value);
      return;
    }
    const timer = window.setTimeout(() => setLast(null), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);

  return value !== null ? { shown: value, closing: false } : { shown: last, closing: last !== null };
}
