import { useAppStore } from "../state/store";
export type { View } from "../state/types";

/**
 * Re-export useAppStore as useStore for backwards-compatibility with phase 01.
 */
export const useStore = useAppStore;
