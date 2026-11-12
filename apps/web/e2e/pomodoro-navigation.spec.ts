/**
 * Pomodoro session lifecycle across navigation — real browser acceptance.
 *
 * Regression: the tick driver used to live INSIDE FocusView, so a running
 * session froze the moment the user navigated to another view — the countdown
 * stalled and the session never completed. The driver is now app-level
 * (`startPomodoroTicker`, mounted once in App.tsx) and the completion is a
 * deadline-based store transition, so the session must complete while the
 * Focus view is UNMOUNTED and still read as finished when the user returns.
 *
 * The timer is started through the real Focus view button. Only the WAIT is
 * shortened — the session's deadline is pulled to +3s through the DEV-only
 * store handle (`__QUIZRADAR_STORE__`, main.tsx, import.meta.env.DEV), the
 * same boundary the Playwright harness already uses. No production test hook
 * is added.
 *
 * NOTE: unlike the visual specs this test must NOT freeze the browser clock —
 * the completion transition compares `pomodoroEndsAt` against `Date.now()`,
 * so it needs a live wall clock.
 */

import { expect, test } from "@playwright/test";
import { applyThemeInitScript } from "./helpers/theme";
import { dismissOnboarding } from "./helpers/app";
import { themeForProject } from "./helpers/theme";

test("pomodoro completes while the Focus view is unmounted and reads finished on return", async ({
  page,
}, testInfo) => {
  const theme = themeForProject(testInfo.project.name);

  // Boot without the frozen clock: this is a wall-clock deadline test.
  await applyThemeInitScript(page, theme);
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 30_000 });
  await dismissOnboarding(page);

  // Start a real session from the Focus view's own control.
  await page.getByTestId("sidebar-nav-focus").click();
  await expect(page.getByTestId("view-focus")).toBeVisible();
  await page.getByTestId("view-focus").getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByTestId("view-focus").getByTestId("focus-timer-readout")).not.toHaveText(
    "25:00",
    { timeout: 15_000 },
  );

  // Shorten the remaining wait to +3s (DEV store handle only shortens the
  // wait — the timer itself was started through the real UI path).
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__QUIZRADAR_STORE__ as
      | {
          setState: (s: Record<string, unknown>) => void;
          getState: () => { pomodoroEndsAt: number | null };
        }
      | undefined;
    const state = store?.getState();
    if (!store || state?.pomodoroEndsAt === null) {
      throw new Error("pomodoro session is not running — cannot shorten its deadline");
    }
    store.setState({ pomodoroEndsAt: Date.now() + 3_000 });
  });

  // Navigate AWAY from Focus: the session must keep running app-level.
  await page.getByTestId("topbar-nav-tasks").click();
  await expect(page.getByTestId("view-tasks")).toBeVisible();

  // The completion fires while Focus is unmounted — deadline-based, driven by
  // the app-level ticker, signalled by the app-wide toast.
  await expect(page.getByTestId("toast-container")).toContainText("Pomodoro session complete!", {
    timeout: 20_000,
  });

  // Returning to Focus shows the session finished: reset readout + ready state.
  await page.getByTestId("sidebar-nav-focus").click();
  await expect(page.getByTestId("view-focus")).toBeVisible();
  await expect(page.getByTestId("focus-timer-readout")).toHaveText("25:00");
  await expect(
    page.getByTestId("view-focus").getByRole("button", { name: "Start", exact: true }),
  ).toBeVisible();
});
