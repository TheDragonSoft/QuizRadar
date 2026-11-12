/**
 * Study data lifecycle — real functional acceptance, no demo seeding.
 *
 * Everything here goes through the REAL user paths:
 *   1. the Add Course modal (the honest empty state's own CTA),
 *   2. a genuine page reload (IndexedDB persistence),
 *   3. the settings "Export Backup (JSON)" control (a real browser download),
 *   4. "Reset All Local Data" with its double confirm,
 *   5. "Import Backup (JSON)" restoring the downloaded file.
 *
 * Nothing is injected through `__QUIZRADAR_STORE__` — this acceptance proves
 * the persistence layer itself, not the store shape (AGENTS.md §3.1: the
 * assertions follow the data, nothing is fabricated).
 */

import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { bootApp } from "./helpers/app";
import { themeForProject } from "./helpers/theme";

const COURSE_CODE = "E2E101";
const COURSE_NAME = "Acceptance Testing";

/**
 * The onboarding wizard reopens whenever `config.onboardingCompleted` is false
 * and the `quizradar_onboarding_dismissed` sessionStorage flag is gone —
 * `resetDatabase()` removes that flag on purpose, so after a wipe the wizard
 * legitimately returns. Dismiss it when present, tolerate its absence (a plain
 * reload keeps the sessionStorage flag).
 */
async function dismissOnboardingIfPresent(page: import("@playwright/test").Page): Promise<void> {
  const wizard = page.getByTestId("modal-onboarding");
  try {
    await wizard.waitFor({ state: "visible", timeout: 5_000 });
  } catch {
    return; // no wizard — nothing to dismiss
  }
  await wizard.getByRole("button", { name: "Close" }).click();
  await wizard.waitFor({ state: "detached", timeout: 15_000 });
}

test("course survives reload, backup export, reset and re-import", async ({ page }, testInfo) => {
  const theme = themeForProject(testInfo.project.name);
  let backupPath: string | null = null;

  try {
    await bootApp(page, theme);

    // 1. Add a course through the real modal, opened from the empty state's
    //    own "Add Course" CTA (scoped to the empty card — the Timeline Horizon
    //    renders a second "Add Course" button).
    await page
      .getByTestId("empty-dashboard-no-courses")
      .getByRole("button", { name: "Add Course" })
      .click();
    const modal = page.getByTestId("modal-add-course");
    await expect(modal).toBeVisible();
    await modal.locator("#course-code").fill(COURSE_CODE);
    await modal.locator("#course-name").fill(COURSE_NAME);
    await modal.getByRole("button", { name: "Save Course" }).click();
    await expect(modal).toBeHidden();
    await expect(page.getByTestId("app-sidebar")).toContainText(COURSE_NAME);

    // 2. A real reload: the course must come back from IndexedDB.
    await page.reload();
    await dismissOnboardingIfPresent(page);
    await expect(page.getByTestId("app-sidebar")).toContainText(COURSE_NAME);

    // 3. Export a real backup download and prove the course is inside it.
    await page.getByRole("button", { name: "Open settings" }).click();
    await expect(page.getByTestId("view-settings")).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export Backup (JSON)" }).click(),
    ]);
    backupPath = path.join(os.tmpdir(), `quizradar-e2e-backup-${Date.now()}.json`);
    await download.saveAs(backupPath);
    const backupJson = fs.readFileSync(backupPath, "utf8");
    expect(backupJson).toContain(COURSE_CODE);

    // 4. Reset with the double confirm — the destructive path the settings
    //    section exposes to a real user.
    await page.getByRole("button", { name: "Reset All Local Data" }).click();
    await page.getByRole("button", { name: "Reset Everything" }).click();
    await page.getByRole("button", { name: "Yes, Permanently Delete" }).click();
    // The wipe removed the onboarding-dismissed flag, so the wizard returns.
    await dismissOnboardingIfPresent(page);
    await expect(page.getByTestId("app-sidebar")).toContainText("No courses enrolled");

    // 5. Import the downloaded backup through the real file input and prove
    //    the course round-trips (a reload proves it was restored into
    //    persistence, not merely into the in-memory store). The import is
    //    async in the page — wait for its honest report toast before
    //    reloading, otherwise the navigation can interrupt it mid-import.
    await page.setInputFiles('input[aria-label="Import Backup (JSON)"]', backupPath);
    await expect(page.getByTestId("toast-container")).toContainText("Imported 1 courses", {
      timeout: 30_000,
    });
    await page.reload();
    await dismissOnboardingIfPresent(page);
    await expect(page.getByTestId("app-sidebar")).toContainText(COURSE_NAME);
  } finally {
    if (backupPath) fs.rmSync(backupPath, { force: true });
  }
});
