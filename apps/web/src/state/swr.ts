import type { GetStatePayload } from "./types";

export const SWR_CACHE_KEY = "quizradar_state_cache_v5";

/**
 * Loads the local cached state synchronously on startup for instantaneous,
 * flicker-free stale-while-revalidate rendering.
 */
export function loadCachedState(): GetStatePayload | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(SWR_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GetStatePayload;
    if (parsed && typeof parsed === "object" && "schedule" in parsed && "config" in parsed) {
      return parsed;
    }
  } catch (error) {
    console.warn("Failed to parse SWR state cache:", error);
  }
  return null;
}

/**
 * Saves fresh state to local SWR cache.
 */
export function saveCachedState(payload: GetStatePayload): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(SWR_CACHE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn("Failed to write SWR state cache:", error);
  }
}

/**
 * Purges local SWR cache (e.g. on full reset/logout).
 */
export function clearCachedState(): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.removeItem(SWR_CACHE_KEY);
  } catch (error) {
    console.warn("Failed to clear SWR state cache:", error);
  }
}
