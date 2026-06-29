import { useUIStore } from '../store/ui';

export function Toast() {
  const toast = useUIStore((s) => s.toast);
  if (!toast) return null;
  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 rounded-lg bg-orbit-text px-4 py-2.5 text-sm text-white shadow-lg">
      {toast}
    </div>
  );
}
