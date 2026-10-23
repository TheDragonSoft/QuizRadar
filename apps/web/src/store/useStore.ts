import { create } from "zustand";

/**
 * The three shell views (docs/rebuild/01-product-spec.md §4.3–§4.5).
 */
export type View = "dashboard" | "tasks" | "calendar";

/**
 * App store stub (zustand). Views exist from phase 01; every data field is
 * added honestly in later phases, populated only from core-derived state via
 * IPC (phase 07) / WASM bindings (phase 11). No fabricated data — ever
 * (`AGENTS.md` §3).
 */
interface AppState {
  view: View;
  setView: (view: View) => void;
}

export const useStore = create<AppState>((set) => ({
  view: "dashboard",
  setView: (view) => set({ view }),
}));
