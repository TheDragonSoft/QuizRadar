import type React from "react";

// Registered modal content components can be mounted by modal ID
export type ModalComponent = React.ComponentType<{
  modalId: string;
  props?: Record<string, unknown>;
  onClose: () => void;
}>;

const modalRegistry = new Map<string, ModalComponent>();

export function registerModal(id: string, component: ModalComponent) {
  modalRegistry.set(id, component);
}

export function unregisterModal(id: string) {
  modalRegistry.delete(id);
}

export function getModalComponent(id: string): ModalComponent | undefined {
  return modalRegistry.get(id);
}
