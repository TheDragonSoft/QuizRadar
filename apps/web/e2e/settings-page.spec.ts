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

  // The view animation is disabled by `reducedMotion: "reduce"`, but give the
  // frame one tick to be certain the page is fully painted. (Baseline = the
  // top of the page, where a fresh visit lands.)
  await page.waitForTimeout(350);

  await expect(page).toHaveScreenshot({
    name: "settings-page-light.png",
    maxDiffPixelRatio: 0.01,
    threshold: 0.2,
  } as ToHaveScreenshotOptions);

  // The section anchors actually scroll: the rail's Integrations link lands
  // the page at the feeds manager.
  await view
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "Integrations" })
    .click();
  await expect(page.getByText(copy.settings.feedsTitle)).toBeInViewport();
});
