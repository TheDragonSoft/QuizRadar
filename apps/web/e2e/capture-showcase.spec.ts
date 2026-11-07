import { test } from "@playwright/test";
import { bootApp } from "./helpers/app";
import { LIGHT_PROJECT } from "./helpers/theme";
import * as path from "node:path";
import * as fs from "node:fs";

const ARTIFACT_DIR = "C:/Users/ANXOMXR/.gemini/antigravity/brain/e59c741e-6493-4854-9810-af2aa79dd262/screenshots";
const DOCS_DIR = path.resolve(process.cwd(), "docs/screenshots/redesign");

// Ensure directories exist
if (!fs.existsSync(ARTIFACT_DIR)) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
}
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
    const p1 = path.join(ARTIFACT_DIR, filename);
    const p2 = path.join(DOCS_DIR, filename);
    await page.screenshot({ path: p1 });
    fs.copyFileSync(p1, p2);
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

  // Return to Dashboard for AMOLED Showcase
  await page.getByRole("button", { name: "Back to dashboard" }).click();
  await page.waitForTimeout(400);

  // 5. AMOLED Variant 1: Pure Starlight (amoled-minimal)
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "amoled-minimal";
    document.documentElement.classList.add("dark");
    localStorage.setItem("quizradar_theme", "amoled-minimal");
  });
  await page.waitForTimeout(500);
  await saveScreenshots("after-desktop-amoled-minimal.png");

  // 6. AMOLED Variant 2: Constellation Sparkles (amoled-sparkle)
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "amoled-sparkle";
    document.documentElement.classList.add("dark");
    localStorage.setItem("quizradar_theme", "amoled-sparkle");
  });
  await page.waitForTimeout(500);
  await saveScreenshots("after-desktop-amoled-sparkle.png");

  // 7. AMOLED Variant 3: Cosmic Stardust (amoled-nebula)
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "amoled-nebula";
    document.documentElement.classList.add("dark");
    localStorage.setItem("quizradar_theme", "amoled-nebula");
  });
  await page.waitForTimeout(500);
  await saveScreenshots("after-desktop-amoled-nebula.png");

  // 8. Astronomical Timeline Horizon on Dashboard (Populated with honest courses & events)
  await page.evaluate(async () => {
    document.documentElement.dataset.theme = "amoled-sparkle";
    document.documentElement.classList.add("dark");
    localStorage.setItem("quizradar_theme", "amoled-sparkle");

    const store = (window as unknown as Record<string, unknown>).__QUIZRADAR_STORE__ as {
      getState: () => {
        upsertCourse: (c: unknown, s?: unknown) => Promise<void>;
        addCustomEvent: (e: unknown) => Promise<void>;
        setView: (v: string) => void;
      };
    };
    if (store) {
      store.getState().setView("dashboard");
      await store.getState().upsertCourse(
        { id: "CSE241", name: "Digital Systems", color: "#3b82f6", credits: 4 },
        [
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
        ],
      );
      await store.getState().upsertCourse(
        { id: "MAT102", name: "Calculus II", color: "#f59e0b", credits: 4 },
        [
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
        ],
      );
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
