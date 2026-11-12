/**
 * Week calendar — visual baseline for the empty week.
 *
 * The calendar is reached through the real top-bar view switcher (the v4
 * segmented control in `apps/web/src/components/TopBar.tsx`). With an empty
 * IndexedDB there are no classes, no exams and no custom events, so
 * `apps/web/src/views/CalendarView.tsx` renders the honest empty week panel
 * (`empty-calendar`) — no fake timetable is injected.
 *
 * The sidebar mini calendar is part of the same frame, so it doubles as the
 * proof that the frozen clock (2026-10-29) really is in effect.
 */

import { expect, test } from "@playwright/test";
import {
  bootApp,
  FIXED_MONTH_LABEL,
  FIXED_TODAY_DAY,
  type ToHaveScreenshotOptions,
} from "./helpers/app";
import { themeForProject } from "./helpers/theme";

// Behavioral smoke (BLOCKING in CI): DOM assertions only. The pixel
// comparison lives in the `@visual`-tagged test below (non-blocking
// `browser-visual` job — rasterisation is platform-sensitive).
test("week calendar renders the empty week", async ({ page }, testInfo) => {
  const theme = themeForProject(testInfo.project.name);

  await bootApp(page, theme);

  await page
    .getByTestId("topbar-view-switcher")
    .getByRole("tab", { name: "Calendar", exact: true })
    .click();

  await expect(page.getByTestId("view-calendar")).toBeVisible();
  await expect(page.getByTestId("empty-calendar")).toContainText("Your Calendar is Ready");

  // The frozen clock is in effect: the mini calendar shows October 2026 with
  // the 29th selected.
  const mini = page.getByTestId("mini-calendar");
  await expect(mini).toContainText(FIXED_MONTH_LABEL);
  await expect(mini.locator('[aria-current="date"]')).toHaveText(FIXED_TODAY_DAY);

  // Nothing was fabricated: the week really has no assessments.
  await expect(page.getByTestId("sidebar-week-exam-count")).toHaveText("0");
});

// Real functional timer navigation (BLOCKING behavioral smoke): the top-bar
// week controls shift the SHARED `currentWeekStart` store field
// (`store.shiftWeek`), which the sidebar range label derives from. The frozen
// clock makes the expected labels deterministic.
test("calendar week navigation shifts and returns the visible week", async ({ page }, testInfo) => {
  const theme = themeForProject(testInfo.project.name);

  await bootApp(page, theme);

  await page
    .getByTestId("topbar-view-switcher")
    .getByRole("tab", { name: "Calendar", exact: true })
    .click();
  await expect(page.getByTestId("view-calendar")).toBeVisible();

  const range = page.getByTestId("sidebar-week-exam-range");
  // The frozen clock's week (Oct 29, 2026 is a Thursday).
  await expect(range).toContainText("Oct 25 – Oct 31");

  const controls = page.getByTestId("topbar-calendar-controls");
  await controls.getByRole("button", { name: "Previous week" }).click();
  await expect(range).toContainText("Oct 18 – Oct 24");

  await controls.getByRole("button", { name: "Next week" }).click();
  await expect(range).toContainText("Oct 25 – Oct 31");

  // Jump to Today returns to the frozen clock's week from a shifted one.
  await controls.getByRole("button", { name: "Previous week" }).click();
  await expect(range).toContainText("Oct 18 – Oct 24");
  await controls.getByRole("button", { name: "Jump to Today" }).click();
  await expect(range).toContainText("Oct 25 – Oct 31");
});

// `@visual` tag: CI runs this ONLY in the non-blocking `browser-visual` job.
test("week calendar visual baseline", { tag: "@visual" }, async ({ page }, testInfo) => {
  const theme = themeForProject(testInfo.project.name);
  await bootApp(page, theme);
  await page
    .getByTestId("topbar-view-switcher")
    .getByRole("tab", { name: "Calendar", exact: true })
    .click();
  await expect(page.getByTestId("view-calendar")).toBeVisible();

  await expect(page).toHaveScreenshot({
    name: `week-calendar-${theme}.png`,
    maxDiffPixelRatio: 0.01,
    threshold: 0.2,
  } as ToHaveScreenshotOptions);
});
