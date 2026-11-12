import { test } from "@playwright/test";
import { bootApp } from "./helpers/app";
import { LIGHT_PROJECT } from "./helpers/theme";
import * as path from "node:path";
import * as fs from "node:fs";

// OPT-IN capture script (run via `pnpm e2e:showcase`). Output lands in the
// untracked staging dir unless the operator explicitly points
// QUIZRADAR_SHOWCASE_DIR at a tracked folder — a run in this repo must never
// rewrite `docs/screenshots/` as a side effect.
const DOCS_DIR = process.env.QUIZRADAR_SHOWCASE_DIR
  ? path.resolve(process.env.QUIZRADAR_SHOWCASE_DIR)
  : path.resolve(process.cwd(), "e2e-results/showcase/redesign");

if (!fs.existsSync(DOCS_DIR)) {
  fs.mkdirSync(DOCS_DIR, { recursive: true });
}

// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== LIGHT_PROJECT,
    "Showcase captures run once on the light project.",
  );
});

test("capture comprehensive redesign showcase screenshots", async ({ page }) => {
  await bootApp(page, "dark");

  const saveScreenshots = async (filename: string) => {
    const target = path.join(DOCS_DIR, filename);
    await page.screenshot({ path: target });
  };

  // 1. Search Palette Modal (Dark Mode) - verifying zero blue outline
  await page.keyboard.press("Control+k");
  await page.waitForSelector('[data-testid="search-palette-modal"]', { state: "visible" });
  await page.waitForTimeout(500);
  await saveScreenshots("after-desktop-search-nobox.png");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // 2. Parallax Scroll on Dashboard (scroll main container down 240px)
  await page.evaluate(() => {
    const main = document.querySelector("main");
    if (main) main.scrollTo({ top: 240, behavior: "instant" });
  });
  await page.waitForTimeout(500);
  await saveScreenshots("after-desktop-dashboard-parallax.png");
  await page.evaluate(() => {
    const main = document.querySelector("main");
    if (main) main.scrollTo({ top: 0, behavior: "instant" });
  });
  await page.waitForTimeout(300);

  // 3. Tasks View - All Assessments Tab with Time Horizons & AI Auto-Detect
  await page.getByRole("button", { name: "Tasks" }).click();
  await page.waitForSelector('[data-testid="tasks-view"]', { state: "visible" });
  await page.getByRole("button", { name: /All Assessments/i }).click();
  await page.waitForTimeout(500);
  await saveScreenshots("after-desktop-tasks-assessments.png");

  // 4. Settings View - Appearance Multi-Theme Architecture
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.waitForSelector('[data-testid="view-settings"]', { state: "visible" });
  await page.waitForTimeout(600);
  await saveScreenshots("after-desktop-settings-appearance.png");

  // Return to Dashboard for the Astronomical Timeline showcase
  await page.getByRole("button", { name: "Back to dashboard" }).click();
  await page.waitForTimeout(400);

  // 5. Astronomical Timeline Horizon on Dashboard (Populated with honest courses & events)
  await page.evaluate(async () => {
    document.documentElement.dataset.theme = "obsidian";
    document.documentElement.classList.add("dark");
    localStorage.setItem("quizradar_theme", "obsidian");

    const store = (window as unknown as Record<string, unknown>).__QUIZRADAR_STORE__ as {
      getState: () => {
        upsertCourse: (c: unknown, s?: unknown) => Promise<void>;
        addCustomEvent: (e: unknown) => Promise<void>;
        setView: (v: string) => void;
      };
    };
    if (store) {
      store.getState().setView("dashboard");
      await store
        .getState()
        .upsertCourse({ id: "CSE241", name: "Digital Systems", color: "#3b82f6", credits: 4 }, [
          {
            id: "slot-1",
            courseId: "CSE241",
            courseName: "Digital Systems",
            day: "Monday",
            dayIndex: 1,
            type: "Lecture",
            room: "Auditorium C",
            startTime: "09:00",
            endTime: "10:30",
            displayTime: "09:00 - 10:30",
          },
        ]);
      await store
        .getState()
        .upsertCourse({ id: "MAT102", name: "Calculus II", color: "#f59e0b", credits: 4 }, [
          {
            id: "slot-2",
            courseId: "MAT102",
            courseName: "Calculus II",
            day: "Wednesday",
            dayIndex: 3,
            type: "Lecture",
            room: "Hall B-101",
            startTime: "11:00",
            endTime: "12:30",
            displayTime: "11:00 - 12:30",
          },
        ]);
      await store.getState().addCustomEvent({
        id: "exam-1",
        title: "Midterm: Circuit Synthesis",
        courseId: "CSE241",
        eventType: "Exam",
        date: "2026-10-30",
        dateIso: "2026-10-30",
        startTime: "09:30",
        endTime: "11:00",
        room: "Auditorium C",
        color: "#3b82f6",
      });
      await store.getState().addCustomEvent({
        id: "quiz-2",
        title: "Quiz 2: Integration",
        courseId: "MAT102",
        eventType: "Quiz",
        date: "2026-11-03",
        dateIso: "2026-11-03",
        startTime: "11:00",
        endTime: "12:00",
        room: "Hall B-101",
        color: "#f59e0b",
      });
      await (store.getState() as unknown as { refreshState: () => Promise<void> }).refreshState();
    }
  });
  await page.waitForTimeout(1200);
  await saveScreenshots("after-desktop-timeline-horizon.png");

  // 9. Widescreen Unified Academic Mission Control (>=1200px viewport, e.g. 1440x900)
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(1000);
  await saveScreenshots("after-desktop-widescreen-mission-control.png");

  // 10. Widescreen Mission Control Scrolled (showing Timetable Matrix & Prioritized Study Deck)
  await page.evaluate(() => {
    const main = document.querySelector("main");
    if (main) main.scrollTo({ top: 460, behavior: "instant" });
  });
  await page.waitForTimeout(600);
  await saveScreenshots("after-desktop-widescreen-mission-control-scrolled.png");
});
