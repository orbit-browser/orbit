import { useUIStore } from '../store/ui';

export function Toast() {
  const toast = useUIStore((s) => s.toast);
  if (!toast) return null;
  return (
    <div className="fixed bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-orbit-text px-4 py-2.5 text-sm text-white shadow-lg">
      <span>{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={toast.action.onClick}
          className="font-semibold text-orbit-primary transition hover:opacity-80"
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
