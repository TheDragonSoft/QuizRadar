import type React from "react";

// Registered modal content components can be mounted by modal ID
export type ModalComponent = React.ComponentType<{
  modalId: string;
  props?: Record<string, unknown>;
  onClose: () => void;
}>;

export interface ModalMeta {
  size?: "sm" | "md" | "lg" | "xl";
  flush?: boolean;
  /**
   * Drop the panel's 1px surface hairline. For modals whose first child is a
   * colored header band that bleeds to the panel's top edge (Onboarding), the
   * hairline rings the band and reads as a white border against the dimmed
   * backdrop; shadow-2xl + the dimmed backdrop carry the separation instead.
   */
  borderless?: boolean;
}

interface ModalRegistration {
  component: ModalComponent;
  meta?: ModalMeta;
}

const modalRegistry = new Map<string, ModalRegistration>();

export function registerModal(id: string, component: ModalComponent, meta?: ModalMeta) {
  modalRegistry.set(id, { component, meta });
}

export function unregisterModal(id: string) {
  modalRegistry.delete(id);
}

export function getModalComponent(id: string): ModalComponent | undefined {
  return modalRegistry.get(id)?.component;
}

export function getModalMeta(id: string): ModalMeta | undefined {
  return modalRegistry.get(id)?.meta;
}
