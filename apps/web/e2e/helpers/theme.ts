/**
 * Theme plumbing for the QuizRadar visual harness.
 *
 * Everything in this file was read out of the app source — it is NOT a guess:
 *
 *  - `apps/web/src/state/store.ts` exports
 *      `export const THEME_STORAGE_KEY = "quizradar-theme";`
 *    and `getInitialTheme()` reads exactly that key out of
 *    `window.localStorage` (falling back to `prefers-color-scheme` only when
 *    the key is absent).
 *  - `applyThemeToDocument()` in the same file applies the theme by putting
 *    the `dark` class on `document.documentElement`
 *    (`root.classList.add("dark")` / `root.classList.remove("dark")`).
 *  - `apps/web/src/tokens.css` defines the dark palette under the `.dark { … }`
 *    selector, and `apps/web/tailwind.config.js` sets `darkMode: "class"`, so
 *    the class on `<html>` is what flips BOTH the CSS custom properties and
 *    the Tailwind `dark:` utilities.
 *
 * Because `getInitialTheme()` runs while the store module is evaluated (i.e.
 * before React mounts), the persisted value has to be in `localStorage`
 * BEFORE the first page script runs — hence `page.addInitScript`.
 */

import type { Page } from "@playwright/test";

/** `localStorage` key the app persists the theme under. */
export const THEME_STORAGE_KEY = "quizradar-theme";

/** Class the app puts on `<html>` for the dark theme. */
export const DARK_CLASS = "dark";

export type ThemeMode = "light" | "dark";

/** Playwright project that renders the light theme. */
export const LIGHT_PROJECT = "chromium-light";

/** Playwright project that renders the dark theme. */
export const DARK_PROJECT = "chromium-dark";

/** Maps a Playwright project name onto the app theme it must render. */
export function themeForProject(projectName: string): ThemeMode {
  return projectName === DARK_PROJECT ? "dark" : "light";
}

/**
 * Seeds the persisted theme before any app script runs, so the store picks it
 * up on its very first evaluation. The `dark` class is added/removed as well
 * so the document is correct even for the frames that render before the
 * store's first effect applies the theme.
 */
export function applyThemeInitScript(page: Page, theme: ThemeMode): Promise<void> {
  return page
    .addInitScript(
      ([key, value, darkClass]) => {
        try {
          window.localStorage.setItem(key, value);
          const root = document.documentElement;
          if (!root) return;
          if (value === "dark") {
            root.classList.add(darkClass);
          } else {
            root.classList.remove(darkClass);
          }
        } catch {
          // A blocked localStorage must not break the harness; the app falls
          // back to `prefers-color-scheme`, and the assertion in the helper
          // will fail loudly instead of silently snapshotting the wrong theme.
        }
      },
      [THEME_STORAGE_KEY, theme, DARK_CLASS] as const,
    )
    .then(() => undefined);
}
