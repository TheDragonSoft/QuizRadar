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

  // 8. Astronomical Timeline Horizon on Dashboard (AMOLED Sparkle - Variant 2)
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "amoled-sparkle";
    document.documentElement.classList.add("dark");
    localStorage.setItem("quizradar_theme", "amoled-sparkle");

    const store = (window as unknown as Record<string, unknown>).__QUIZRADAR_STORE__ as {
      getState: () => { data: Record<string, unknown> };
      setState: (s: Record<string, unknown>) => void;
    };
    if (store) {
      const prev = store.getState().data;
      store.setState({
        data: {
          ...prev,
          schedule: {
            ...((prev.schedule as Record<string, unknown>) || {}),
            courses: [
              { id: "CS241", code: "CS241", title: "Digital Systems", color: "#3b82f6", credits: 4 },
              { id: "MATH102", code: "MATH102", title: "Calculus II", color: "#f59e0b", credits: 4 },
              { id: "PHYS201", code: "PHYS201", title: "University Physics", color: "#8b5cf6", credits: 4 },
              { id: "CHEM101", code: "CHEM101", title: "General Chemistry", color: "#10b981", credits: 3 },
            ],
            slots: [
              { id: "slot-1", courseId: "CS241", dayOfWeek: "Monday", startTime: "10:00", endTime: "11:30", room: "Hall B-101" },
              { id: "slot-2", courseId: "MATH102", dayOfWeek: "Tuesday", startTime: "13:00", endTime: "14:30", room: "Room 402" },
              { id: "slot-3", courseId: "PHYS201", dayOfWeek: "Wednesday", startTime: "09:00", endTime: "10:30", room: "SciLab 3" },
            ],
          },
          dashboard: {
            ...((prev.dashboard as Record<string, unknown>) || {}),
            weekCount: 3,
            examsAheadCount: 2,
            readinessPercent: 68,
            totalTopicsCount: 12,
            completedTopicsCount: 8,
            allUpcoming: [
              {
                id: "exam-cs241",
                courseId: "CS241",
                courseName: "Digital Systems",
                title: "Midterm Exam: Circuit Synthesis",
                assessmentType: "Midterm",
                dateIso: "2026-10-30",
                displayTime: "09:30 AM",
                daysUntil: 1,
                isUpcoming: true,
                room: "Auditorium C",
                color: "#3b82f6",
              },
              {
                id: "exam-math102",
                courseId: "MATH102",
                courseName: "Calculus II",
                title: "Quiz 2: Multi-Variable Integration",
                assessmentType: "Quiz",
                dateIso: "2026-11-02",
                displayTime: "11:00 AM",
                daysUntil: 4,
                isUpcoming: true,
                room: "Room 402",
                color: "#f59e0b",
              },
              {
                id: "exam-phys201",
                courseId: "PHYS201",
                courseName: "University Physics",
                title: "Final Exam: Electromagnetism & Optics",
                assessmentType: "Final",
                dateIso: "2026-11-10",
                displayTime: "14:00 PM",
                daysUntil: 12,
                isUpcoming: true,
                room: "Hall A",
                color: "#8b5cf6",
              },
              {
                id: "exam-chem101",
                courseId: "CHEM101",
                courseName: "General Chemistry",
                title: "Term Paper & Lab Defense",
                assessmentType: "Exam",
                dateIso: "2026-11-22",
                displayTime: "10:00 AM",
                daysUntil: 24,
                isUpcoming: true,
                room: "Lab 2B",
                color: "#10b981",
              },
            ],
            studyRecommendations: [
              {
                assessmentId: "exam-cs241",
                courseId: "CS241",
                courseName: "Digital Systems",
                title: "Midterm Exam: Circuit Synthesis",
                kind: "Midterm",
                urgency: "critical",
                topics: [
                  { topicIndex: 0, title: "Karnaugh Maps & Quine-McCluskey", completed: true, key: "t1" },
                  { topicIndex: 1, title: "Synchronous State Machine Design", completed: true, key: "t2" },
                  { topicIndex: 2, title: "Setup & Hold Time Margin Analysis", completed: false, key: "t3" },
                ],
              },
              {
                assessmentId: "exam-math102",
                courseId: "MATH102",
                courseName: "Calculus II",
                title: "Quiz 2: Multi-Variable Integration",
                kind: "Quiz",
                urgency: "warning",
                topics: [
                  { topicIndex: 0, title: "Polar & Cylindrical Coordinate Transforms", completed: true, key: "t4" },
                  { topicIndex: 1, title: "Jacobian Determinants", completed: false, key: "t5" },
                ],
              },
            ],
          },
        },
      });
    }
  });
  await page.waitForTimeout(600);
  await saveScreenshots("after-desktop-timeline-horizon.png");

  // 9. Widescreen Unified Academic Mission Control (>=1200px viewport)
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(600);
  await saveScreenshots("after-desktop-widescreen-mission-control.png");
});
