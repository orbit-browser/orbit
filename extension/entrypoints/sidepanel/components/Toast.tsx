import { useUIStore } from '../store/ui';

export function Toast() {
  const toast = useUIStore((s) => s.toast);
  const dismissToast = useUIStore((s) => s.dismissToast);
  if (!toast) return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-lg bg-orbit-text/90 px-3 py-2 text-xs text-white shadow-orbit-overlay">
        <span>{toast.message}</span>
        {toast.action && (
          <button
            type="button"
            onClick={() => {
              const action = toast.action;
              dismissToast();
              action?.onClick();
            }}
            className="shrink-0 cursor-pointer font-semibold text-orbit-primary transition hover:opacity-80"
          >
            {toast.action.label}
          </button>
        )}
      </div>
    </div>
  );
}
