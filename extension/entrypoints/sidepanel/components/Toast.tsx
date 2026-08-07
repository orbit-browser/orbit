import { useUIStore } from '../store/ui';

export function Toast() {
  const toast = useUIStore((s) => s.toast);
  if (!toast) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
      <div className="rounded-lg bg-orbit-text/90 text-white text-xs px-3 py-2 shadow-orbit-overlay">
        {toast}
      </div>
    </div>
  );
}
