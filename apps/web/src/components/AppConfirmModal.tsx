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
    // Close FIRST: an onConfirm that opens a nested app-confirm (the reset
    // double-confirm) registers under the same id, and closing afterwards
    // removes the nested dialog before it ever renders. Close-then-confirm
    // pops this instance, so the nested one lands on a clean stack.
    onClose();
    if (modalProps.onConfirm) {
      modalProps.onConfirm();
    }
  };

  const handleCancel = () => {
    if (modalProps.onCancel) {
      modalProps.onCancel();
    }
    onClose();
  };

  return (
    <div className="w-full">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          {destructive ? (
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10 text-red-700 dark:text-red-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-ink)]">
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
          className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="mt-4 text-sm text-[var(--text-muted)]">{message}</div>

      <div className="mt-6 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={handleCancel}
          className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--text)] transition hover:bg-[var(--surface-hover)]"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          className={`rounded-xl px-4 py-2 text-sm font-semibold text-white transition ${
            destructive
              ? "bg-red-700 hover:bg-red-800 shadow-sm shadow-red-500/20"
              : "bg-[var(--accent-fill)] hover:bg-[var(--accent-fill-hover)] shadow-sm shadow-blue-500/20"
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
