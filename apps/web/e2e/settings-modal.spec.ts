/**
 * Settings modal — one modal baseline, captured in the light theme only.
 *
 * The modal is opened through the real top-bar control ("Open settings"),
 * which opens the `settings` modal at its full width with the Account tab
 * selected (`copy.topBar.settingsAria` -> `openModal({ id: "settings", … })`).
 */

import { expect, test } from "@playwright/test";
import { bootApp, type ToHaveScreenshotOptions } from "./helpers/app";
import { LIGHT_PROJECT } from "./helpers/theme";

// eslint-disable-next-line no-empty-pattern -- Playwright requires the destructured fixtures arg
test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== LIGHT_PROJECT,
    "The Settings modal baseline is captured in the light theme only.",
  );
});

test("settings modal opens over the empty dashboard", async ({ page }) => {
  await bootApp(page, "light");

  await page.getByRole("button", { name: "Open settings" }).click();

  const modal = page.getByTestId("modal-settings");
  await expect(modal).toBeVisible();
  await expect(modal.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(modal.getByRole("tab", { name: "Account" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // The modal panel animation is disabled by `reducedMotion: "reduce"`, but
  // give the frame one tick to be certain the panel is fully painted.
  await page.waitForTimeout(350);

  await expect(page).toHaveScreenshot({
    name: "settings-modal-light.png",
    maxDiffPixelRatio: 0.01,
    threshold: 0.2,
  } as ToHaveScreenshotOptions);
});
