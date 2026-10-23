/**
 * Empty modal-stack provider — placeholder for the single declarative layer
 * that replaces the v4 hardcoded Escape-stack (`04` §4.7). The modal registry
 * (13 modals, `01` §5) is wired in phases 08–10; nothing exists to render
 * today, so this renders nothing.
 */
export function ModalStack() {
  return null;
}
