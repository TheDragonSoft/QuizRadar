import { AlertTriangle, X } from "lucide-react";
import { copy } from "../copy";

export interface AppConfirmModalProps {
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
}

export function AppConfirmModal({
  props,
  onClose,
}: {
  modalId: string;
  props?: Record<string, unknown>;
  onClose: () => void;
}) {
  const modalProps = (props || {}) as AppConfirmModalProps;
  const title = modalProps.title || copy.confirm.defaultTitle;
  const message = modalProps.message || "";
  const confirmLabel = modalProps.confirmLabel || copy.confirm.confirmAction;
  const cancelLabel = modalProps.cancelLabel || copy.confirm.cancelAction;
  const destructive = modalProps.destructive ?? false;

  const handleConfirm = () => {
    if (modalProps.onConfirm) {
      modalProps.onConfirm();
    }
    onClose();
  };

  const handleCancel = () => {
    if (modalProps.onCancel) {
      modalProps.onCancel();
    }
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      className="relative w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl transition-all"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          {destructive ? (
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10 text-red-600 dark:text-red-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
              <AlertTriangle className="h-5 w-5" />
            </div>
          )}
          <h2 id="confirm-modal-title" className="text-lg font-bold text-[var(--text)]">
            {title}
          </h2>
        </div>
        <button
          type="button"
          onClick={handleCancel}
          aria-label={copy.common.close}
          className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--border)]/30 hover:text-[var(--text)]"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="mt-4 text-sm text-[var(--text-muted)]">{message}</div>

      <div className="mt-6 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={handleCancel}
          className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--text)] transition hover:bg-[var(--border)]/30"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          className={`rounded-xl px-4 py-2 text-sm font-semibold text-white transition ${
            destructive
              ? "bg-red-600 hover:bg-red-700 shadow-sm shadow-red-500/20"
              : "bg-[var(--accent)] hover:bg-[var(--accent-hover)] shadow-sm shadow-blue-500/20"
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
