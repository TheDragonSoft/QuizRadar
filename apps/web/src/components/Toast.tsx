import React from "react";
import { AlertCircle, AlertTriangle, CheckCircle, Info, X } from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
import type { ToastItem } from "../state/types";

const TOAST_ICONS = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error: AlertCircle,
};

const TOAST_STYLES = {
  info: "border-blue-500/30 bg-blue-50/90 text-blue-900 dark:bg-blue-950/80 dark:text-blue-100",
  success:
    "border-emerald-500/30 bg-emerald-50/90 text-emerald-900 dark:bg-emerald-950/80 dark:text-emerald-100",
  warning:
    "border-amber-500/30 bg-amber-50/90 text-amber-900 dark:bg-amber-950/80 dark:text-amber-100",
  error: "border-rose-500/30 bg-rose-50/90 text-rose-900 dark:bg-rose-950/80 dark:text-rose-100",
};

interface ToastProps {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}

const ToastMessage: React.FC<ToastProps> = ({ toast, onDismiss }) => {
  const Icon = TOAST_ICONS[toast.type];

  return (
    <div
      role={toast.type === "error" ? "alert" : "status"}
      data-testid={`toast-${toast.id}`}
      className={`pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-xl border p-3.5 shadow-lg backdrop-blur-md transition-all ${TOAST_STYLES[toast.type]}`}
    >
      <Icon className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
      <div className="flex-1 text-xs font-semibold leading-relaxed">{toast.message}</div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label={copy.common.close}
        className="rounded-lg p-1 opacity-70 hover:opacity-100 transition"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
};

export const ToastContainer: React.FC = () => {
  const toasts = useAppStore((s) => s.toasts);
  const removeToast = useAppStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div
      data-testid="toast-container"
      aria-live="polite"
      className="pointer-events-none fixed bottom-20 right-4 z-[120] flex flex-col gap-2 sm:bottom-6"
    >
      {toasts.map((toast) => (
        <ToastMessage key={toast.id} toast={toast} onDismiss={removeToast} />
      ))}
    </div>
  );
};
