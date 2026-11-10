import type { GetStatePayload } from "./types";
import { isLegacyPositionalTopicKey } from "../pwadapters/idbStore";

export const SWR_CACHE_KEY = "quizradar_state_cache_v5";

/**
 * Checks whether a state payload contains pre-v3 positional topic keys.
 * If legacy positional keys are found, the cached snapshot is stale and
 * should not be painted before the key migration has completed.
 */
export function hasLegacyPositionalKeys(payload: GetStatePayload): boolean {
  if (!payload || typeof payload !== "object") return false;

  // 1. Check tasks inside studyTasksPayload
  const days = payload.studyTasksPayload?.days;
  if (Array.isArray(days)) {
    for (const day of days) {
      if (Array.isArray(day?.tasks)) {
        for (const task of day.tasks) {
          if (task?.key && isLegacyPositionalTopicKey(task.key)) {
            return true;
          }
        }
      }
    }
  }

  // 2. Check dashboard study recommendations
  const recs = payload.dashboard?.studyRecommendations;
  if (Array.isArray(recs)) {
    for (const rec of recs) {
      if (Array.isArray(rec?.topics)) {
        for (const topic of rec.topics) {
          if (topic?.key && isLegacyPositionalTopicKey(topic.key)) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

/**
 * Loads the local cached state synchronously on startup for instantaneous,
 * flicker-free stale-while-revalidate rendering.
 *
 * If pre-v3 positional topic keys are detected, the stale cache is discarded
 * and treated as loading (returning null) so unmigrated unchecked topics
 * are never briefly painted on the cold frame.
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
      if (hasLegacyPositionalKeys(parsed)) {
        // Discard stale pre-v3 snapshot so cold frame doesn't flicker unchecked topics
        return null;
      }
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
