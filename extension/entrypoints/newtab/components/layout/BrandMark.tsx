import { navigate } from '../../lib/navigation';

/** 메인 · 아틀라스가 공유하는 좌측 상단 브랜드 마크 (워드마크 없이 심볼만). */
export function BrandMark() {
  return (
    <button
      type="button"
      className="brand-mark"
      onClick={() => navigate('#/')}
      aria-label="Orbit 홈"
      title="Orbit 홈"
    >
      <img src="/orbit-mark.png" alt="Orbit" />
    </button>
  );
}
