/**
 * OPT-IN UX-audit capture sweep — never part of `pnpm e2e`.
 *
 * Writes an honest screenshot inventory of the web app into
 * `<repo>/audit-capture/web/` (full view captures, every modal reachable from
 * the UI, every shipped theme, and a 390x844 mobile pass). Run explicitly:
 *
 *   pnpm --dir apps/web e2e:showcase capture-audit-sweep.spec.ts
 *
 * Honesty rules (AGENTS §3.1): a fresh browser context starts with an empty
 * IndexedDB and NOTHING is injected into the product UI — every app capture
 * shows the genuine first-run empty state. Populated fixtures only exist in
 * the Ladle workbench (captured separately by audit-capture/capture-ladle.cjs).
 *
 * Theme note, read out of the source before writing this spec: the app ships
 * exactly THREE concrete themes (see `KNOWN_DARK_THEMES` / `KNOWN_LIGHT_THEMES`
 * in apps/web/src/state/storage.ts and the `html[data-theme=…]` blocks in
 * apps/web/src/tokens.css — the Settings picker offers the same set):
 *   - "solar"         → data-theme="solar"           (Solar Dawn, light)
 *   - "obsidian"      → data-theme="obsidian"        (Obsidian Cosmic, dark)
 *   - "amoled-nebula" → data-theme="amoled-nebula"   (AMOLED Cosmic Stardust)
 * An "aurora" / "editorial" theme does not exist in this tree, so it cannot be
 * captured; the three real ones are captured instead.
 */

import { test, expect, type Page } from "@playwright/test";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { FIXED_NOW, settleForScreenshot } from "./helpers/app";
import { LIGHT_PROJECT, THEME_STORAGE_KEY, type ThemeMode } from "./helpers/theme";

/** Repo-root audit output folder (absolute, outside apps/web). */
const appDir = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(appDir, "..", "..", "..", "audit-capture", "web");

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

/** The concrete theme ids the app actually ships (see file header). */
type ConcreteTheme = "solar" | "obsidian" | "amoled-nebula";
const THEMES: ConcreteTheme[] = ["obsidian", "amoled-nebula", "solar"];
const THEME_IS_DARK: Record<ConcreteTheme, boolean> = {
  solar: false,
  obsidian: true,
  "amoled-nebula": true,
};

// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== LIGHT_PROJECT,
    "Audit captures run once on the light project; themes are seeded per page instead.",
  );
});

/**
 * Seeds a concrete theme id before any app script runs — same plumbing as
 * `applyThemeInitScript` in helpers/theme.ts but with the concrete ids the
 * Settings picker offers (obsidian / amoled-nebula / solar). The store's
 * `getInitialTheme()` reads exactly this key and `applyThemeToDocument`
 * normalizes the `dark` class + `data-theme` attribute on mount.
 */
function seedConcreteTheme(page: Page, themeId: ConcreteTheme): Promise<void> {
  const dark = THEME_IS_DARK[themeId];
  return page
    .addInitScript(
      ([key, value, darkClass, attr, isDark]) => {
        try {
          window.localStorage.setItem(key, value);
          const root = document.documentElement;
          if (!root) return;
          if (isDark) {
            root.classList.add(darkClass);
          } else {
            root.classList.remove(darkClass);
          }
          root.setAttribute("data-theme", attr);
        } catch {
          // A blocked localStorage must not break the harness; the app falls
          // back to prefers-color-scheme and the settle check fails loudly.
        }
      },
      [THEME_STORAGE_KEY, themeId, "dark", themeId, dark] as const,
    )
    .then(() => undefined);
}

/** Boots the app with the pinned repo clock and an optional seeded theme. */
async function boot(page: Page, themeId: ConcreteTheme | null): Promise<void> {
  await page.clock.setFixedTime(FIXED_NOW);
  if (themeId) await seedConcreteTheme(page, themeId);
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 60_000 });
}

/**
 * Dismisses the first-run wizard through its own Close button (never by
 * completing it — completing would write `onboardingCompleted` and change the
 * honest empty state). Only waits when the wizard can still appear: once the
 * app wrote its `quizradar_onboarding_dismissed` sessionStorage flag (same
 * context), later boots skip the wizard entirely.
 */
async function dismissOnboardingIfDue(page: Page, due: boolean): Promise<void> {
  if (!due) return;
  const wizard = page.getByTestId("modal-onboarding");
  await wizard.waitFor({ state: "visible", timeout: 30_000 });
  await wizard.getByRole("button", { name: "Close" }).click();
  await wizard.waitFor({ state: "detached", timeout: 15_000 });
}

/** Viewport screenshot into the audit folder (the app shell never scrolls the document; `main` does). */
async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(OUT_DIR, name) });
}

/** Scrolls the app's internal `main` scroller (top or bottom). */
async function scrollMain(page: Page, to: "top" | "bottom"): Promise<void> {
  await page.evaluate((where) => {
    const main = document.querySelector("main");
    if (!main) return;
    main.scrollTo({ top: where === "top" ? 0 : main.scrollHeight, behavior: "instant" });
  }, to);
  await page.waitForTimeout(300);
}

/** Navigates through the real UI chrome (desktop: top bar + sidebar buttons). */
async function gotoView(page: Page, view: string): Promise<void> {
  const testIdMap: Record<string, string> = {
    dashboard: "view-dashboard",
    tasks: "view-tasks",
    calendar: "view-calendar",
    focus: "view-focus",
    help: "view-help",
    settings: "view-settings",
  };
  if (view === "settings") {
    await page.getByRole("button", { name: "Open settings" }).click();
  } else if (view === "focus" || view === "help") {
    await page.getByTestId(`sidebar-nav-${view}`).click();
  } else {
    await page.getByTestId(`topbar-nav-${view}`).click();
  }
  await expect(page.getByTestId(testIdMap[view])).toBeVisible({ timeout: 15_000 });
}

/**
 * The full desktop capture pass for one theme: every main view, the Tasks
 * sub-tabs, the Settings sections, and the below-the-fold bottoms of the long
 * views. Extra focus tabs are captured once (obsidian) to bound the run.
 */
async function captureViewsForTheme(
  page: Page,
  theme: ConcreteTheme,
  onboardingDue: boolean,
  includeFocusTabs: boolean,
): Promise<void> {
  await boot(page, theme);
  await dismissOnboardingIfDue(page, onboardingDue);
  await settleForScreenshot(page, (THEME_IS_DARK[theme] ? "dark" : "light") as ThemeMode);

  // Dashboard (top + bottom — the dashboard is taller than one viewport).
  await gotoView(page, "dashboard");
  await scrollMain(page, "top");
  await shot(page, `dashboard-${theme}-desktop.png`);
  await scrollMain(page, "bottom");
  await shot(page, `dashboard-bottom-${theme}-desktop.png`);

  // Tasks — three in-view tabs (Daily Roadmap / Assessments Ledger / Grade Center & GPA).
  await gotoView(page, "tasks");
  await scrollMain(page, "top");
  await shot(page, `tasks-roadmap-${theme}-desktop.png`);
  await page.getByRole("button", { name: "All Assessments" }).click();
  await page.waitForTimeout(400);
  await shot(page, `tasks-ledger-${theme}-desktop.png`);
  await page.getByTestId("tab-grades").click();
  await page.waitForTimeout(400);
  await shot(page, `tasks-grades-${theme}-desktop.png`);

  // Week calendar.
  await gotoView(page, "calendar");
  await scrollMain(page, "top");
  await shot(page, `calendar-${theme}-desktop.png`);

  // Focus — pomodoro tab by default; the other three tabs once (obsidian).
  await gotoView(page, "focus");
  await scrollMain(page, "top");
  await shot(page, `focus-pomodoro-${theme}-desktop.png`);
  if (includeFocusTabs) {
    for (const [tab, name] of [
      ["Practice Quiz", "practice"],
      ["Flashcards", "flashcards"],
      ["Missed Questions", "mistakes"],
    ] as const) {
      await page.getByRole("tab", { name: tab }).click();
      await page.waitForTimeout(400);
      await shot(page, `focus-${name}-${theme}-desktop.png`);
    }
    await page.getByRole("tab", { name: "Focus Pomodoro" }).click();
    await page.waitForTimeout(300);
  }

  // Help & Tiers (top + bottom).
  await gotoView(page, "help");
  await scrollMain(page, "top");
  await shot(page, `help-${theme}-desktop.png`);
  await scrollMain(page, "bottom");
  await shot(page, `help-bottom-${theme}-desktop.png`);

  // Settings — one capture per section (the page scrolls through them).
  await gotoView(page, "settings");
  await page.waitForTimeout(500);
  await shot(page, `settings-account-${theme}-desktop.png`);
  await page.getByTestId("settings-nav-courses").click();
  await page.waitForTimeout(600);
  await shot(page, `settings-courses-${theme}-desktop.png`);
  await page.getByTestId("settings-nav-integrations").click();
  await page.waitForTimeout(600);
  await shot(page, `settings-integrations-${theme}-desktop.png`);
}

test("capture genuine cold first-run state (empty IndexedDB, solar light default)", async ({
  page,
}) => {
  // No theme seeding at all: a fresh context with the light OS preference is
  // the real first-run condition. The onboarding wizard is part of that state.
  await boot(page, null);
  await settleForScreenshot(page, "light");

  const wizard = page.getByTestId("modal-onboarding");
  await wizard.waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(600);
  await shot(page, "cold-first-run-onboarding-solar-desktop.png");

  // Close (not complete) the wizard: the empty state stays empty.
  await wizard.getByRole("button", { name: "Close" }).click();
  await wizard.waitFor({ state: "detached", timeout: 15_000 });
  await page.waitForTimeout(500);
  await shot(page, "cold-first-run-dashboard-empty-solar-desktop.png");
});

test("capture all main views in the obsidian theme (desktop 1440x900)", async ({ page }) => {
  await captureViewsForTheme(page, "obsidian", true, true);
});

test("capture all main views in the amoled-nebula theme (desktop 1440x900)", async ({ page }) => {
  await captureViewsForTheme(page, "amoled-nebula", true, false);
});

test("capture all main views in the solar theme (desktop 1440x900)", async ({ page }) => {
  await captureViewsForTheme(page, "solar", true, false);
});

test("capture every modal reachable from the UI (obsidian, empty state)", async ({ page }) => {
  await boot(page, "obsidian");
  await dismissOnboardingIfDue(page, true);
  await settleForScreenshot(page, "dark");

  // Search palette (Ctrl+K / top bar search).
  await page.keyboard.press("Control+k");
  await page.getByTestId("modal-search-palette").waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(600);
  await shot(page, "modal-search-palette-obsidian-desktop.png");
  await page.keyboard.press("Escape");
  await page.getByTestId("modal-search-palette").waitFor({ state: "detached", timeout: 10_000 });

  // Create/edit event (sidebar primary action).
  await page.getByTestId("sidebar-create-event").click();
  await page.getByTestId("modal-create-edit-event").waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(600);
  await shot(page, "modal-create-edit-event-obsidian-desktop.png");
  await page.keyboard.press("Escape");
  await page.getByTestId("modal-create-edit-event").waitFor({ state: "detached", timeout: 10_000 });

  // Create/edit assessment (Tasks header CTA).
  await gotoView(page, "tasks");
  await page.getByTestId("add-assessment-btn").click();
  await page
    .getByTestId("modal-create-edit-assessment")
    .waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(600);
  await shot(page, "modal-create-edit-assessment-obsidian-desktop.png");
  await page.keyboard.press("Escape");
  await page
    .getByTestId("modal-create-edit-assessment")
    .waitFor({ state: "detached", timeout: 10_000 });

  // Cloud backup & transfer (top bar "Data & Backup").
  await page.getByRole("button", { name: "Data & Backup" }).click();
  await page.getByTestId("modal-cloud-sync").waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(600);
  await shot(page, "modal-cloud-sync-obsidian-desktop.png");
  await page.keyboard.press("Escape");
  await page.getByTestId("modal-cloud-sync").waitFor({ state: "detached", timeout: 10_000 });

  // Account profile (Settings → Account → "Manage Accounts"; works signed out).
  await gotoView(page, "settings");
  await page.getByRole("button", { name: "Manage Accounts" }).click();
  await page.getByTestId("modal-account-profile").waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(600);
  await shot(page, "modal-account-profile-obsidian-desktop.png");
  await page.keyboard.press("Escape");
  await page.getByTestId("modal-account-profile").waitFor({ state: "detached", timeout: 10_000 });

  // Add course (Settings → Courses → "Add Course").
  await page.getByTestId("settings-nav-courses").click();
  await page.getByRole("button", { name: "Add Course", exact: true }).click();
  await page.getByTestId("modal-add-course").waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(600);
  await shot(page, "modal-add-course-obsidian-desktop.png");
  await page.keyboard.press("Escape");
  await page.getByTestId("modal-add-course").waitFor({ state: "detached", timeout: 10_000 });

  // Scan progress (top bar "Sync") — non-dismissible overlay that runs a real
  // browser-tier scan. With no sources configured it ends honestly empty; the
  // success outcome auto-closes the overlay ~2.2s after it renders, so the
  // outcome shot is best-effort and skipped when the overlay already closed.
  await page.getByRole("button", { name: "Sync", exact: true }).click();
  await page.getByTestId("modal-scan-progress").waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(500);
  await shot(page, "modal-scan-progress-obsidian-desktop.png");
  try {
    await page
      .locator('[data-testid="modal-scan-progress"]')
      .getByText(/Scan complete|Scan failed|Scan canceled/)
      .waitFor({ state: "visible", timeout: 4000 });
    await page.waitForTimeout(200);
    await shot(page, "modal-scan-progress-outcome-obsidian-desktop.png");
  } catch {
    // Outcome already rendered and auto-closed the overlay — the in-flight
    // capture above is then the only honest frame available.
  }
  const overlayOpen = await page.getByTestId("modal-scan-progress").isVisible();
  if (overlayOpen) {
    // The overlay draws two "Close" buttons while finished (an X icon in the
    // header and a footer button) — the footer one is the explicit exit.
    await page
      .getByTestId("modal-scan-progress")
      .getByRole("button", { name: "Close" })
      .last()
      .click();
    await page.getByTestId("modal-scan-progress").waitFor({ state: "detached", timeout: 10_000 });
  }

  // Browser companion tier: desktop-only "Push GCal" is hidden (replaced by
  // ".ics export" once assessments exist), so there is no dead error toast.
  await expect(page.getByRole("button", { name: "Push GCal" })).toHaveCount(0);
});

test("capture main views at mobile 390x844 (obsidian)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page, "obsidian");
  await dismissOnboardingIfDue(page, true);
  await settleForScreenshot(page, "dark");

  // MobileNav destinations: dashboard, tasks, calendar, focus, settings, help.
  const mobileViews = ["dashboard", "tasks", "calendar", "focus", "settings", "help"] as const;
  for (const view of mobileViews) {
    await page.getByTestId(`mobilenav-${view}`).click();
    const testId = view === "help" ? "view-help" : `view-${view}`;
    await expect(page.getByTestId(testId)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(400);
    await shot(page, `mobile-${view}-obsidian-390x844.png`);
  }
});
