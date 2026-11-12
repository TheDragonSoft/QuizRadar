/**
 * Dashboard — visual baseline for the genuine first-run empty state.
 *
 * The app is local-first with no server, so a fresh browser context has no
 * courses, no assessments and no connected sources. The v4 dashboard layout
 * (`DashboardView`) renders its first-run empty state inside the study panel
 * (`empty-dashboard-no-courses`, v4's "Add your first course…" card) and the
 * honest empty hero; nothing is injected to make the baseline look fuller
 * (AGENTS.md §3.1 honesty doctrine).
 */

import { expect, test } from "@playwright/test";
import { bootApp, type ToHaveScreenshotOptions } from "./helpers/app";
import { themeForProject } from "./helpers/theme";

// Behavioral smoke (BLOCKING in CI): DOM assertions only — the pixel
// comparison lives in the `@visual`-tagged test below, which CI runs in the
// optional `browser-visual` job (`--grep @visual`) because rasterisation is
// platform-sensitive while these DOM assertions are not.
test("dashboard renders the honest empty state", async ({ page }, testInfo) => {
  const theme = themeForProject(testInfo.project.name);

  await bootApp(page, theme);

  await expect(page.getByTestId("view-dashboard")).toBeVisible();

  // The real empty state, asserted before the pixels are compared.
  const empty = page.getByTestId("empty-dashboard-no-courses");
  await expect(empty).toBeVisible();
  await expect(empty).toContainText("Add your first course to build your study plan");
  await expect(empty.getByRole("button", { name: "Add Course" })).toBeVisible();
  await expect(empty.getByRole("button", { name: "Connect Account" })).toBeVisible();

  // The hero carries the honest "nothing scheduled yet" state. At ≥1200px the
  // widescreen layout renders the VISIBLE hero under the `-top` testid
  // (`DashboardView` picks the testid from its `matchMedia("(min-width:
  // 1200px)")` query); the plain `dashboard-next-up-hero` testid then belongs
  // to the sr-only scroll anchor, which `getByRole` cannot see inside.
  const viewportWidth = page.viewportSize()?.width ?? 0;
  const heroTestId =
    viewportWidth >= 1200 ? "dashboard-next-up-hero-top" : "dashboard-next-up-hero";
  const hero = page.getByTestId(heroTestId);
  await expect(hero).toBeVisible();
  await expect(hero).toContainText("No Upcoming Quizzes Scheduled");
  await expect(hero.getByRole("button", { name: "Sync Radar" })).toBeVisible();

  // Nothing was fabricated: the radar really is empty.
  await expect(page.getByTestId("sidebar-week-exam-count")).toHaveText("0");
  await expect(page.getByTestId("app-sidebar")).toContainText("No courses enrolled");
});

// `@visual` tag: CI runs this ONLY in the non-blocking `browser-visual` job.
test("dashboard visual baseline", { tag: "@visual" }, async ({ page }, testInfo) => {
  const theme = themeForProject(testInfo.project.name);
  await bootApp(page, theme);
  await expect(page.getByTestId("view-dashboard")).toBeVisible();

  await expect(page).toHaveScreenshot({
    name: `dashboard-${theme}.png`,
    maxDiffPixelRatio: 0.01,
    threshold: 0.2,
  } as ToHaveScreenshotOptions);
});
