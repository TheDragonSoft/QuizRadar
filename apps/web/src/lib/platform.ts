/**
 * Platform awareness utility for keyboard shortcuts and OS-specific affordances.
 * Accurately detects macOS / iOS vs. Windows / Linux across browser and Tauri environments.
 */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent || "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export function getShortcutModifier(): string {
  return isMac() ? "⌘" : "Ctrl";
}

export function getSearchShortcutLabel(): string {
  return isMac() ? "⌘K" : "Ctrl K";
}
