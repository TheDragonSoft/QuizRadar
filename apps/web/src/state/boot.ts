/**
 * Cold-start boot for the browser (PWA) tier.
 *
 * The browser tier keeps TWO local copies of the user's data:
 * - IndexedDB (`pwadapters/idbStore.ts`) — the source of truth;
 * - localStorage (`state/swr.ts`) — the last snapshot, rewritten on every
 *   successful state load.
 *
 * A cold offline start must show the user's LAST snapshot, not a dashboard
 * that claims "you have no courses, no assessments and no grades" while the
 * IndexedDB read is still in flight. `bootQuizRadar` therefore:
 *
 * 1. seeds the store with the last snapshot BEFORE the first paint, and
 * 2. when there is no snapshot at all, starts the first real load and lets
 *    the caller hold the app behind an honest "loading your saved data"
 *    state until it finishes — the truth is "we are still reading", not
 *    "you have nothing".
 */
import { useAppStore } from "./store";
import { loadCachedState } from "./swr";

export interface BootResult {
  /** True when the last saved snapshot was restored (the UI may render now). */
  hasSnapshot: boolean;
  /** Resolves when the first real state load has finished. */
  ready: Promise<void>;
}

/**
 * Restores the last saved snapshot into the store and starts the first real
 * load when there is nothing to restore.
 */
export function bootQuizRadar(): BootResult {
  const snapshot = loadCachedState();
  if (snapshot) {
    // Synchronous, so the FIRST paint already shows the user's own data.
    useAppStore.setState({ data: snapshot });
    return { hasSnapshot: true, ready: Promise.resolve() };
  }
  // No snapshot: the first load decides what the user sees. The caller keeps
  // the app behind the loading state until this resolves.
  return { hasSnapshot: false, ready: useAppStore.getState().loadInitialData() };
}
