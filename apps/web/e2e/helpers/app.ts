/**
 * Shared page helpers for the QuizRadar visual harness.
 *
 * The app is local-first and has NO server: a fresh browser context starts
 * with an empty IndexedDB (`apps/web/src/pwadapters/idbStore.ts`) and the
 * WASM core (`apps/web/src/pwadapters/rpcAdapter.ts` -> `buildFullState()`)
 * derives an honestly empty state from it. Nothing in this helper injects
 * courses, exams or events — the committed baselines capture the genuine
 * first-run empty UI (AGENTS.md §3.1 honesty doctrine).
 */

import { expect, type Page } from "@playwright/test";
import { applyThemeInitScript, DARK_CLASS, type ThemeMode } from "./theme";

/** The matcher set `expect(page)` returns. */
type PageMatchers = ReturnType<typeof expect<Page>>;

/**
 * The options bag of `expect(page).toHaveScreenshot(...)`.
 *
 * Playwright 1.64's published typings only document the snapshot name as the
 * FIRST argument (`toHaveScreenshot(name, options)`), but the runtime also
 * honours `name` inside the options bag — that is the call shape this harness
 * is specified to use, and the run output proves it is honoured (the
 * baselines land at `e2e-baselines/<name>.png`).
 *
 * This alias keeps the specs type-clean without changing the call shape.
 */
export type ToHaveScreenshotOptions = Parameters<PageMatchers["toHaveScreenshot"]>[0];

/**
 * The instant every spec is pinned to.
 *
 * The UI renders real dates (sidebar mini calendar, week grid day headers,
 * the "today" disc, relative countdowns), so without a frozen clock the
 * committed baselines would break at midnight. The time zone is pinned to
 * UTC in `playwright.config.ts` so the rendered date is the same everywhere.
 */
export const FIXED_NOW = new Date("2026-10-29T12:00:00Z");

/** The day-of-month the frozen clock lands on (sidebar mini calendar). */
export const FIXED_TODAY_DAY = "29";

/** The month label the sidebar mini calendar renders for the frozen week. */
export const FIXED_MONTH_LABEL = "October 2026";

/**
 * Waits for the first-run onboarding wizard and dismisses it deterministically.
 *
 * `apps/web/src/App.tsx` opens the wizard once the first real state load has
 * finished and `config.onboardingCompleted` is still false — which is exactly
 * the case in a fresh context. We close it through its own "Close" button
 * (the same control a user clicks); the wizard never sets
 * `onboardingCompleted`, so the empty state is preserved.
 */
export async function dismissOnboarding(page: Page): Promise<void> {
  const wizard = page.getByTestId("modal-onboarding");
  await wizard.waitFor({ state: "visible", timeout: 30_000 });
  await wizard.getByRole("button", { name: "Close" }).click();
  await wizard.waitFor({ state: "detached", timeout: 15_000 });
}

/**
 * Waits until the page is safe to snapshot:
 *  - the bundled webfont finished loading (no FOUT in the baseline),
 *  - the app's 200 ms `theme-transition` class is gone (no half-faded frame),
 *  - the theme actually landed on `<html>` the way the app applies it.
 */
export async function settleForScreenshot(page: Page, theme: ThemeMode): Promise<void> {
  await page.waitForFunction(() => document.fonts.status === "loaded", null, {
    timeout: 15_000,
  });
  await page.waitForFunction(
    () => !document.documentElement.classList.contains("theme-transition"),
    null,
    { timeout: 10_000 },
  );

  const hasDarkClass = await page.evaluate(
    (darkClass) => document.documentElement.classList.contains(darkClass),
    DARK_CLASS,
  );
  expect(
    hasDarkClass,
    `expected the "${theme}" theme to be applied to <html> (dark class present: ${hasDarkClass})`,
  ).toBe(theme === "dark");
}

/**
 * Boots the app in a known state: frozen clock, persisted theme, onboarding
 * dismissed, fonts loaded.
 */
export async function bootApp(page: Page, theme: ThemeMode): Promise<void> {
  // The clock must be frozen before the first page script runs, otherwise the
  // store captures the real "today" while the module is evaluated.
  await page.clock.setFixedTime(FIXED_NOW);
  await applyThemeInitScript(page, theme);

  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await dismissOnboarding(page);
  await settleForScreenshot(page, theme);
}
