import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
import type { ModalInstance } from "../state/types";
import { getModalComponent } from "./modalRegistry";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalLayerProps {
  modal: ModalInstance;
  index: number;
  isTop: boolean;
  onClose: () => void;
}

const ModalLayer: React.FC<ModalLayerProps> = ({ modal, index, isTop, onClose }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Focus trap & restore discipline
  useEffect(() => {
    if (!isTop) return;

    // Save previously focused element
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    const container = containerRef.current;
    if (!container) return;

    // Focus first focusable element or modal container
    const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    if (focusable.length > 0) {
      focusable[0].focus();
    } else {
      container.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        const elements = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (elements.length === 0) {
          e.preventDefault();
          return;
        }

        const first = elements[0];
        const last = elements[elements.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    container.addEventListener("keydown", handleKeyDown);

    return () => {
      container.removeEventListener("keydown", handleKeyDown);
      // Restore focus
      if (previousFocusRef.current && typeof previousFocusRef.current.focus === "function") {
        previousFocusRef.current.focus();
      }
    };
  }, [isTop]);

  const Component = getModalComponent(modal.id);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && modal.dismissible !== false) {
      onClose();
    }
  };

  const zIndex = 50 + index * 5;

  return (
    <div
      role="presentation"
      style={{ zIndex }}
      onClick={handleBackdropClick}
      className="fixed inset-0 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm transition-opacity"
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        data-testid={`modal-${modal.id}`}
        className="relative w-full max-w-lg rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-6 shadow-2xl focus:outline-none transition-all"
      >
        {/* Default close button */}
        {modal.dismissible !== false && (
          <button
            type="button"
            onClick={onClose}
            aria-label={copy.common.close}
            className="absolute right-4 top-4 rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] transition"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        )}

        {/* Modal content */}
        {Component ? (
          <Component modalId={modal.id} props={modal.props} onClose={onClose} />
        ) : (
          <div>
            <h2 className="text-lg font-bold text-[var(--text)] capitalize">
              {modal.id.replace(/-/g, " ")}
            </h2>
            <div className="mt-2 text-sm text-[var(--text-muted)]">
              {typeof modal.props?.message === "string" ? (
                modal.props.message
              ) : (
                <p>Modal content placeholder for `{modal.id}`.</p>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-[var(--surface-border)] px-4 py-2 text-sm font-semibold text-[var(--text)] hover:bg-[var(--surface-hover)] transition"
              >
                {copy.common.close}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const ModalStack: React.FC = () => {
  const openModals = useAppStore((s) => s.openModals);
  const closeModal = useAppStore((s) => s.closeModal);

  // Global Escape key listener: closes the top modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && openModals.length > 0) {
        e.preventDefault();
        const topModal = openModals[openModals.length - 1];
        if (topModal.dismissible !== false) {
          closeModal();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openModals, closeModal]);

  if (openModals.length === 0) {
    return null;
  }

  return (
    <div data-testid="modal-stack-root">
      {openModals.map((modal, index) => (
        <ModalLayer
          key={modal.id}
          modal={modal}
          index={index}
          isTop={index === openModals.length - 1}
          onClose={() => closeModal(modal.id)}
        />
      ))}
    </div>
  );
};
