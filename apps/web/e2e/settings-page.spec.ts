/**
 * Settings page — one full-screen baseline, captured in the light theme only.
 *
 * Settings left the modal stack: the top-bar control ("Open settings") now
 * switches to the `settings` VIEW — one scrollable page with all three
 * sections and an anchored side rail (`copy.topBar.settingsAria` ->
 * `setView("settings")`).
 */

import { expect, test } from "@playwright/test";
import { bootApp, type ToHaveScreenshotOptions } from "./helpers/app";
import { LIGHT_PROJECT } from "./helpers/theme";
import { copy } from "../src/copy";

// eslint-disable-next-line no-empty-pattern -- Playwright requires the destructured fixtures arg
test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== LIGHT_PROJECT,
    "The Settings page baseline is captured in the light theme only.",
  );
});

test("settings page opens full-screen with every section present", async ({ page }) => {
  await bootApp(page, "light");

  await page.getByRole("button", { name: "Open settings" }).click();

  const view = page.getByTestId("view-settings");
  await expect(view).toBeVisible();
  await expect(view.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await expect(view.getByRole("navigation", { name: "Settings sections" })).toBeVisible();

  // All three sections live on the one page (no tabs to lose state in).
  for (const sectionId of [
    "settings-section-account",
    "settings-section-courses",
    "settings-section-integrations",
  ]) {
    await expect(page.locator(`#${sectionId}`)).toBeAttached();
  }

  // ---- Behavioural guard: the rail's shape and the scroll-spy's default ----
  //
  // The visual baseline cannot catch these: a 1%-pixel budget plus
  // pixelmatch's antialiasing filter let a whole theme card and a swapped
  // rail highlight pass unnoticed. These are DOM assertions, so they fail
  // loudly on a material change.
  //
  // DOM facts (verified against the rendered page):
  //  - the rail is `<nav aria-label="Settings sections">` holding a "Back to
  //    dashboard" button plus one `<ul>` (role `list`) with exactly three
  //    `<button>`s named "Account", "Courses", "Integrations";
  //  - the active rail button carries `aria-current="true"`, and at the top
  //    of the page that is the Account button (the scroll-spy's default).
  const rail = view.getByRole("navigation", { name: "Settings sections" });
  const railSections = rail.getByRole("list");
  const railButtons = railSections.getByRole("button");

  await expect(railButtons).toHaveCount(3);
  await expect(railSections.getByRole("button", { name: "Account", exact: true })).toHaveCount(1);
  await expect(railSections.getByRole("button", { name: "Courses", exact: true })).toHaveCount(1);
  await expect(railSections.getByRole("button", { name: "Integrations", exact: true })).toHaveCount(
    1,
  );

  // Exactly one rail button is the current section — Account, at the top.
  await expect(railSections.locator('[aria-current="true"]')).toHaveCount(1);
  await expect(railSections.getByRole("button", { name: "Account", exact: true })).toHaveAttribute(
    "aria-current",
    "true",
  );

  // ---- Behavioural guard: the dark-theme picker offers exactly two themes --
  //
  // DOM facts (verified against the rendered page):
  //  - "Preferred Dark Theme" is a `<span>` label; its wrapper `<div>` holds
  //    the option grid, so the label's `../..` is the block to scope to —
  //    scoping matters, because the LIGHT picker above it also renders cards;
  //  - each option is a `<button>` whose accessible name folds the card
  //    title, its tag and its description together, e.g.
  //    "Obsidian Cosmic Default Dark Deep space obsidian with …".
  const darkThemeLabel = view.getByText("Preferred Dark Theme", { exact: true });
  await expect(darkThemeLabel).toHaveCount(1);
  const darkThemeBlock = darkThemeLabel.locator("xpath=../..");
  const darkThemeOptions = darkThemeBlock.getByRole("button");

  // EXACTLY TWO dark themes ship: Obsidian Cosmic and AMOLED Cosmic Stardust.
  await expect(darkThemeOptions).toHaveCount(2);
  await expect(
    darkThemeBlock.getByRole("button", { name: /^Obsidian Cosmic(?:\s|$)/ }),
  ).toHaveCount(1);
  await expect(
    darkThemeBlock.getByRole("button", { name: /^AMOLED Cosmic Stardust(?:\s|$)/ }),
  ).toHaveCount(1);
  // The card titles themselves — exact, so "Obsidian Cosmic Dust" would fail.
  await expect(darkThemeBlock.getByText("Obsidian Cosmic", { exact: true })).toHaveCount(1);
  await expect(darkThemeBlock.getByText("AMOLED Cosmic Stardust", { exact: true })).toHaveCount(1);

  // The retired AMOLED variants are NOT offered as options: v1
  // "Pure Starlight" and v2 "Constellation Sparkles" are gone from the DOM
  // (only their legacy ids survive in `state/storage.ts` for migration).
  await expect(darkThemeBlock.getByRole("button", { name: /Pure Starlight/i })).toHaveCount(0);
  await expect(darkThemeBlock.getByRole("button", { name: /Constellation Sparkles/i })).toHaveCount(
    0,
  );
  await expect(darkThemeBlock.getByText("Pure Starlight", { exact: true })).toHaveCount(0);
  await expect(darkThemeBlock.getByText("Constellation Sparkles", { exact: true })).toHaveCount(0);

  // The section anchors actually scroll: the rail's Integrations link lands
  // the page at the feeds manager.
  await view
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "Integrations" })
    .click();
  await expect(page.getByText(copy.settings.feedsTitle)).toBeInViewport();
});

// `@visual` tag: CI runs this ONLY in the non-blocking `browser-visual` job —
// the pixel comparison is platform-sensitive, the DOM assertions above are not.
test("settings page visual baseline", { tag: "@visual" }, async ({ page }) => {
  await bootApp(page, "light");
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByTestId("view-settings")).toBeVisible();

  // The view animation is disabled by `reducedMotion: "reduce"`, but give
  // the frame one tick to be certain the page is fully painted. (Baseline =
  // the top of the page, where a fresh visit lands.)
  await page.waitForTimeout(350);

  await expect(page).toHaveScreenshot({
    name: "settings-page-light.png",
    maxDiffPixelRatio: 0.01,
    threshold: 0.2,
  } as ToHaveScreenshotOptions);
});
